import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '../db.js';
import { appointmentSchema, validateBookingDate, pagination } from '../domain.js';
import { requireValue } from '../errors.js';

const joins = [
  {$lookup:{from:'services',localField:'serviceId',foreignField:'_id',as:'service'}},
  {$unwind:{path:'$service',preserveNullAndEmptyArrays:true}},
  {$lookup:{from:'users',localField:'customerId',foreignField:'_id',as:'customer'}},
  {$unwind:{path:'$customer',preserveNullAndEmptyArrays:true}},
  {$project:{'customer.emailVerified':0,'customer.isBlocked':0}},
];
export async function findAppointments(db, filter, query={}) {
  const {page,limit,skip}=pagination(query);
  const [data,total]=await Promise.all([
    db.collection('appointments').aggregate([{$match:filter},{$sort:{createdAt:-1}},{$skip:skip},{$limit:limit},...joins]).toArray(),
    db.collection('appointments').countDocuments(filter),
  ]);
  return {data,total,page,pages:Math.ceil(total/limit)};
}
export function appointmentRoutes({db,client,guards,config,stripe}) {
  const router=Router(), appointments=db.collection('appointments');
  router.use(guards.authenticate);
  router.get('/',guards.role('customer'),async(req,res)=>{
    res.json(await findAppointments(db,{customerId:req.user._id},req.query));
  });
  router.post('/',guards.role('customer'),async(req,res)=>{
    const input=appointmentSchema.parse(req.body);
    validateBookingDate(input.appointmentDate,input.timeSlot,config.SALON_TIMEZONE);
    const session=client.startSession();let record;
    try {
      await session.withTransaction(async()=>{
        const service=await db.collection('services').findOneAndUpdate({_id:objectId(input.serviceId),status:'active'},{$inc:{bookingVersion:1}},{session,returnDocument:'after'});
        requireValue(service,404,'This service is not available for booking.');
        record={...input,serviceId:service._id,customerId:req.user._id,serviceName:service.serviceName,servicePrice:service.price,currency:config.STRIPE_CURRENCY,status:'pending',paymentStatus:'unpaid',slotReserved:true,createdAt:new Date(),updatedAt:new Date()};
        const result=await appointments.insertOne(record,{session});record._id=result.insertedId;
      });
    } finally {await session.endSession();}
    res.status(201).json({data:record,message:'Appointment requested. The salon will confirm it shortly.'});
  });
  router.get('/:id',async(req,res)=>{
    const id=objectId(req.params.id);requireValue(id,400,'Invalid appointment ID.');
    const result=await findAppointments(db,{_id:id,...(req.user.role==='admin'?{}:{customerId:req.user._id})});
    requireValue(result.data[0],404,'Appointment not found.');res.json({data:result.data[0]});
  });
  router.patch('/:id/cancel',guards.role('customer'),async(req,res)=>{
    const id=objectId(req.params.id);requireValue(id,400,'Invalid appointment ID.');
    const record=await appointments.findOneAndUpdate({_id:id,customerId:req.user._id,status:'pending'},{$set:{status:'cancelled',slotReserved:false,updatedAt:new Date()}},{returnDocument:'after'});
    requireValue(record,409,'Only your own pending appointments can be cancelled.');res.json({data:record,message:'Appointment cancelled.'});
  });
  return router;
}
export function adminAppointmentRoutes({db,guards,stripe}) {
  const router=Router(), appointments=db.collection('appointments');
  router.use(guards.authenticate,guards.role('admin'));
  router.get('/',async(req,res)=>{
    const status=z.enum(['pending','confirmed','cancelled']).optional().parse(req.query.status || undefined);
    res.json(await findAppointments(db,status?{status}:{},req.query));
  });
  router.patch('/:id',async(req,res)=>{
    const id=objectId(req.params.id);requireValue(id,400,'Invalid appointment ID.');
    const {status}=z.object({status:z.enum(['confirmed','cancelled'])}).strict().parse(req.body);
    const record=await appointments.findOneAndUpdate({_id:id,status:status==='confirmed'?'pending':{$in:['pending','confirmed']}},{$set:{status,slotReserved:status!=='cancelled',updatedAt:new Date()}},{returnDocument:'after'});
    requireValue(record,409,'This appointment has already changed. Refresh and try again.');
    if(status==='cancelled' && record.stripeSessionId && stripe) {
      try{await stripe.checkout.sessions.expire(record.stripeSessionId);}catch {/* A completed session is still reconciled by the verified webhook. */}
    }
    res.json({data:record,message:`Appointment ${status}.`});
  });
  return router;
}
