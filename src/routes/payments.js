import { Router } from 'express';
import { objectId } from '../db.js';
import { requireValue } from '../errors.js';

export function paymentRoutes({db,guards,stripe,config}) {
  const router=Router(), appointments=db.collection('appointments');
  router.use(guards.authenticate,guards.role('customer'));
  router.post('/:id/checkout',async(req,res)=>{
    requireValue(stripe,503,'Online payment is being configured. Please contact the salon.');
    const id=objectId(req.params.id);requireValue(id,400,'Invalid appointment ID.');
    const filter={_id:id,customerId:req.user._id,status:'confirmed',paymentStatus:'unpaid'};
    const appointment=await appointments.findOne(filter);requireValue(appointment,409,'Only your confirmed, unpaid appointments can be paid.');
    if(appointment.stripeSessionId){
      const existing=await stripe.checkout.sessions.retrieve(appointment.stripeSessionId);
      if(existing.status==='open') return res.json({url:existing.url});
      requireValue(existing.payment_status!=='paid',409,'Payment received. Waiting for verified confirmation.');
    }
    const claimed=await appointments.findOneAndUpdate({...filter,$or:[{checkoutLockUntil:{$exists:false}},{checkoutLockUntil:{$lt:new Date()}}]},{$set:{checkoutLockUntil:new Date(Date.now()+60000)},$inc:{checkoutAttempt:1}},{returnDocument:'after'});
    requireValue(claimed,409,'Checkout is already being prepared. Please try again shortly.');
    try {
      const session=await stripe.checkout.sessions.create({
        mode:'payment',payment_method_types:['card'],customer_email:req.user.email,
        client_reference_id:id.toString(),metadata:{appointmentId:id.toString(),customerId:req.user.id},
        line_items:[{price_data:{currency:claimed.currency,unit_amount:Math.round(claimed.servicePrice*100),product_data:{name:claimed.serviceName}},quantity:1}],
        success_url:`${config.CLIENT_URL}/payment/success?appointment=${id}`,
        cancel_url:`${config.CLIENT_URL}/payment/cancel?appointment=${id}`,
        expires_at:Math.floor(Date.now()/1000)+1800,
      },{idempotencyKey:`salonbook-${id}-${claimed.checkoutAttempt}`});
      const saved=await appointments.updateOne(filter,{$set:{stripeSessionId:session.id},$unset:{checkoutLockUntil:''}});
      if(!saved.matchedCount){await stripe.checkout.sessions.expire(session.id);requireValue(false,409,'Appointment changed while checkout was prepared.');}
      res.json({url:session.url});
    } catch(error){await appointments.updateOne({_id:id},{$unset:{checkoutLockUntil:''}});throw error;}
  });
  return router;
}

export async function reconcilePayment(event,{db,client,config}) {
  const success=['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type);
  const failed=event.type==='checkout.session.async_payment_failed';
  if(!success && !failed)return;
  const checkout=event.data.object;
  if(success && checkout.payment_status!=='paid')return;
  const id=objectId(checkout.metadata?.appointmentId);requireValue(id,400,'Missing appointment reference.');
  const session=client.startSession();
  try {
    await session.withTransaction(async()=>{
      const appointment=await db.collection('appointments').findOne({_id:id},{session});requireValue(appointment,400,'Unknown appointment.');
      requireValue(checkout.metadata.customerId===appointment.customerId.toString() && checkout.amount_total===Math.round(appointment.servicePrice*100) && checkout.currency===appointment.currency,400,'Payment does not match this appointment.');
      const transactions=db.collection('transactions');
      const existing=await transactions.findOne({stripeSessionId:checkout.id},{session});
      if(existing?.status==='paid')return;
      await transactions.updateOne({stripeSessionId:checkout.id},{$set:{appointmentId:id,customerId:appointment.customerId,amount:checkout.amount_total/100,currency:checkout.currency,status:success?'paid':'failed',stripeEventId:event.id},$setOnInsert:{createdAt:new Date()}},{upsert:true,session});
      if(success)await db.collection('appointments').updateOne({_id:id},{$set:{paymentStatus:'paid',paidAt:new Date(),updatedAt:new Date()}},{session});
    });
  } finally {await session.endSession();}
}

export function stripeWebhook(context) {
  return async(req,res)=>{
    requireValue(context.stripe && context.config.STRIPE_WEBHOOK_SECRET,503,'Payment webhook is not configured.');
    let event;
    try {event=context.stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],context.config.STRIPE_WEBHOOK_SECRET);}
    catch {return res.status(400).json({message:'Invalid webhook signature.'});}
    await reconcilePayment(event,context);res.json({received:true});
  };
}
