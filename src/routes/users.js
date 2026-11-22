import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '../db.js';
import { requireValue } from '../errors.js';
import { escapeRegex, pagination } from '../domain.js';
const publicFields={name:1,email:1,image:1,role:1,isBlocked:1,phone:1,createdAt:1};
export function profileRoutes({db,guards}) {
  const router=Router();router.use(guards.authenticate);
  router.get('/',(req,res)=>res.json({data:req.user}));
  router.patch('/',async(req,res)=>{
    const data=z.object({name:z.string().trim().min(2).max(80),image:z.url().refine(v=>/^https?:/.test(v)).or(z.literal('')).optional(),phone:z.string().trim().max(25).regex(/^[+\d\s()-]*$/).optional()}).strict().parse(req.body);
    await db.collection('users').updateOne({_id:req.user._id},{$set:{...data,updatedAt:new Date()}});
    res.json({data:await db.collection('users').findOne({_id:req.user._id},{projection:publicFields}),message:'Profile updated.'});
  });return router;
}
export function userRoutes({db,guards}) {
  const router=Router();router.use(guards.authenticate,guards.role('admin'));
  router.get('/',async(req,res)=>{
    const {page,limit,skip}=pagination(req.query),filter={role:'customer'};
    if(typeof req.query.search==='string' && req.query.search){const regex={$regex:escapeRegex(req.query.search.slice(0,100)),$options:'i'};filter.$or=[{name:regex},{email:regex}];}
    const [data,total]=await Promise.all([db.collection('users').find(filter,{projection:publicFields}).sort({createdAt:-1}).skip(skip).limit(limit).toArray(),db.collection('users').countDocuments(filter)]);
    res.json({data,total,page,pages:Math.ceil(total/limit)});
  });
  router.get('/:id',async(req,res)=>{
    const id=objectId(req.params.id);requireValue(id,400,'Invalid customer ID.');
    const user=await db.collection('users').findOne({_id:id,role:'customer'},{projection:publicFields});requireValue(user,404,'Customer not found.');res.json({data:user});
  });
  router.patch('/:id/block',async(req,res)=>{
    const id=objectId(req.params.id);requireValue(id,400,'Invalid customer ID.');
    const {isBlocked}=z.object({isBlocked:z.boolean()}).strict().parse(req.body);
    const user=await db.collection('users').findOneAndUpdate({_id:id,role:'customer'},{$set:{isBlocked,updatedAt:new Date()}},{returnDocument:'after',projection:publicFields});
    requireValue(user,404,'Customer not found.');
    res.json({data:user,message:isBlocked?'Customer blocked.':'Customer unblocked.'});
  });return router;
}
