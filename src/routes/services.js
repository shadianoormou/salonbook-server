import { Router } from 'express';
import { serviceSchema, categories, escapeRegex, pagination, timeSlots, salonNow } from '../domain.js';
import { objectId } from '../db.js';
import { requireValue } from '../errors.js';

export function serviceRoutes({db, guards, config}) {
  const router = Router(), services = db.collection('services');
  router.get('/categories', async (req, res) => {
    const counts = await services.aggregate([{$match: {status:'active'}}, {$group: {_id:'$category',count:{$sum:1}}}]).toArray();
    res.json({data: categories.map(name => ({name, count: counts.find(c => c._id === name)?.count || 0}))});
  });
  router.get('/', async (req, res) => {
    const {page,limit,skip} = pagination(req.query), filter = {status:'active'};
    if (typeof req.query.search === 'string') filter.serviceName = {$regex: escapeRegex(req.query.search.slice(0,100)), $options:'i'};
    if (typeof req.query.category === 'string' && req.query.category) filter.category = req.query.category;
    const sort = req.query.sort === 'price-asc' ? {price:1,_id:1} : req.query.sort === 'price-desc' ? {price:-1,_id:1} : {createdAt:-1,_id:1};
    const [data,total] = await Promise.all([services.find(filter).sort(sort).skip(skip).limit(limit).toArray(),services.countDocuments(filter)]);
    res.json({data,total,page,pages:Math.ceil(total/limit)});
  });
  router.get('/:id/slots', guards.authenticate, async (req,res) => {
    const id = objectId(req.params.id); requireValue(id,400,'Invalid service ID.');
    const service = await services.findOne({_id:id,status:'active'}); requireValue(service,404,'This service is unavailable.');
    const date = req.query.date; requireValue(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date),400,'Select a date.');
    const bookings = await db.collection('appointments').find({appointmentDate:date,slotReserved:true},{projection:{timeSlot:1}}).toArray();
    const now = salonNow(config.SALON_TIMEZONE);
    res.json({data:timeSlots.map(value=>({value,available:!(date<now.date || (date===now.date && value<=now.time) || bookings.some(b=>b.timeSlot===value))})),timeZone:config.SALON_TIMEZONE});
  });
  router.get('/:id', guards.authenticate, async (req,res) => {
    const id = objectId(req.params.id); requireValue(id,400,'Invalid service ID.');
    const data = await services.findOne({_id:id,...(req.user.role==='admin'?{}:{status:'active'})});
    requireValue(data,404,'Service not found or no longer available.'); res.json({data});
  });
  return router;
}
export function adminServiceRoutes({db, guards}) {
  const router = Router(), services = db.collection('services');
  router.use(guards.authenticate,guards.role('admin'));
  router.get('/',async(req,res)=>{
    const {page,limit,skip}=pagination(req.query), filter={};
    if(typeof req.query.search==='string') filter.serviceName={$regex:escapeRegex(req.query.search.slice(0,100)),$options:'i'};
    const [data,total]=await Promise.all([services.find(filter).sort({createdAt:-1}).skip(skip).limit(limit).toArray(),services.countDocuments(filter)]);
    res.json({data,total,page,pages:Math.ceil(total/limit)});
  });
  router.post('/',async(req,res)=>{
    const data=serviceSchema.parse(req.body);
    requireValue(new URL(data.image).hostname==='i.ibb.co',400,'Please upload the service image using the image picker.');
    const record={...data,createdAt:new Date(),updatedAt:new Date()};
    const result=await services.insertOne(record); res.status(201).json({data:{...record,_id:result.insertedId}});
  });
  router.patch('/:id',async(req,res)=>{
    const id=objectId(req.params.id); requireValue(id,400,'Invalid service ID.');
    const existing=await services.findOne({_id:id});requireValue(existing,404,'Service not found.');
    const data=serviceSchema.partial().parse(req.body);requireValue(Object.keys(data).length,400,'No changes supplied.');
    if(data.image && data.image!==existing.image) requireValue(new URL(data.image).hostname==='i.ibb.co',400,'Please upload your new service image.');
    const result=await services.findOneAndUpdate({_id:id},{$set:{...data,updatedAt:new Date()}},{returnDocument:'after'});
    res.json({data:result});
  });
  router.delete('/:id',async(req,res)=>{
    const id=objectId(req.params.id);requireValue(id,400,'Invalid service ID.');
    const used=await db.collection('appointments').countDocuments({serviceId:id});
    requireValue(!used,409,'This service has appointment history. Deactivate it to preserve bookings and payments.');
    const result=await services.deleteOne({_id:id});requireValue(result.deletedCount,404,'Service not found.');res.json({message:'Service deleted.'});
  });
  return router;
}
