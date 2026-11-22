import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { readConfig } from '../src/config.js';
import { connectDatabase } from '../src/db.js';
import { createAuthentication } from '../src/auth.js';
import { createGuards } from '../src/middleware/authenticate.js';
import { createApp } from '../src/app.js';
let repl,client,db,app,admin,alice,bob,service,appointment,stripe,config;
const origin='http://localhost:3000';
async function register(email){
  const signup=await request(app).post('/api/auth/sign-up/email').set('Origin',origin).send({name:email.split('@')[0],email,password:'TestPassword9',role:'admin',isBlocked:false});assert.equal(signup.status,200,JSON.stringify(signup.body));
  const jar=new Map();for(const value of signup.headers['set-cookie']){const pair=value.split(';')[0],at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
  const cookie=[...jar].map(([key,value])=>`${key}=${value}`).join('; ');
  assert.ok(cookie.includes('session_token'),`Missing session cookie: ${Object.keys(signup.body)}`);
  const jwt=await request(app).get('/api/auth/token').set('Origin',origin).set('Cookie',cookie);assert.equal(jwt.status,200,JSON.stringify(jwt.body));
  return {cookie,token:jwt.body.token,user:signup.body.user};
}
function as(user,method,path){return request(app)[method](path).set('Origin',origin).set('Cookie',user.cookie).set('Authorization',`Bearer ${user.token}`);}
before(async()=>{
  repl=await MongoMemoryReplSet.create({binary:{version:'7.0.24'},replSet:{count:1,storageEngine:'wiredTiger'}});
  config=readConfig({MONGODB_URI:repl.getUri(),MONGODB_DB:'salonbook_tests',BETTER_AUTH_SECRET:randomBytes(48).toString('hex'),BETTER_AUTH_URL:origin,CLIENT_URL:origin,STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:'whsec_fixture_only'});
  ({client,db}=await connectDatabase(config));
  const auth=createAuthentication(db,client,config);stripe=new Stripe(config.STRIPE_SECRET_KEY);
  const context={db,client,config,auth,stripe};context.guards=createGuards(context);app=createApp(context);
  admin=await register('admin@example.test');alice=await register('alice@example.test');bob=await register('bob@example.test');
  await db.collection('users').updateOne({email:'admin@example.test'},{$set:{role:'admin'}});
  const result=await db.collection('services').insertOne({serviceName:'Test Cut',category:'Haircut & Styling',description:'A thoughtful cut and professional finish.',price:45,duration:60,image:'https://i.ibb.co/fixture/image.jpg',status:'active',createdAt:new Date()});service=result.insertedId.toString();
}, {timeout:120000});
after(async()=>{await client?.close();await repl?.stop();});
test('registration cannot grant admin role and requires password case rules',async()=>{
  assert.equal(alice.user.role,'customer');
  const weak=await request(app).post('/api/auth/sign-up/email').set('Origin',origin).send({name:'Weak',email:'weak@example.test',password:'lowercase'});assert.equal(weak.status,400);
});
test('public browsing hides inactive services and supports search and price sorting',async()=>{
  await db.collection('services').insertOne({serviceName:'Hidden Cut',category:'Haircut & Styling',price:1,status:'inactive'});
  const result=await request(app).get('/api/services?search=Cut&sort=price-asc');assert.equal(result.status,200);assert.equal(result.body.data.length,1);assert.equal(result.body.data[0].serviceName,'Test Cut');
});
test('JWT and server roles reject anonymous, forged, and customer admin requests',async()=>{
  assert.equal((await request(app).get('/api/profile')).status,401);
  assert.equal((await request(app).get('/api/profile').set('Cookie',alice.cookie).set('Authorization','Bearer forged')).status,401);
  assert.equal((await as(alice,'get','/api/admin/services')).status,403);
  assert.equal((await as(admin,'post','/api/appointments').send({})).status,403);
});
test('profile updates cannot change role or another account',async()=>{
  assert.equal((await as(alice,'patch','/api/profile').send({name:'Alice',role:'admin'})).status,400);
  const saved=await as(alice,'patch','/api/profile').send({name:'Alice Updated',phone:'+880 1700000000'});assert.equal(saved.status,200);assert.equal(saved.body.data.role,'customer');
});
test('concurrent requests reserve a slot only once and enforce appointment ownership',async()=>{
  const input={serviceId:service,appointmentDate:new Date(Date.now()+5*86400000).toISOString().slice(0,10),timeSlot:'14:00',message:'Test appointment'};
  const results=await Promise.all([as(alice,'post','/api/appointments').send(input),as(bob,'post','/api/appointments').send(input)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const winner=results.find(r=>r.status===201);appointment=winner.body.data;
  const owner=appointment.customerId===alice.user.id?alice:bob,other=owner===alice?bob:alice;
  appointment.owner=owner;appointment.other=other;
  assert.equal((await as(other,'get',`/api/appointments/${appointment._id}`)).status,404);
  assert.equal((await as(other,'patch',`/api/appointments/${appointment._id}/cancel`)).status,409);
  assert.equal((await as(owner,'post',`/api/payments/${appointment._id}/checkout`)).status,409);
});
test('only pending appointments can be confirmed and customer cannot cancel a confirmed one',async()=>{
  assert.equal((await as(admin,'patch',`/api/admin/appointments/${appointment._id}`).send({status:'confirmed'})).status,200);
  assert.equal((await as(admin,'patch',`/api/admin/appointments/${appointment._id}`).send({status:'confirmed'})).status,409);
  assert.equal((await as(appointment.owner,'patch',`/api/appointments/${appointment._id}/cancel`)).status,409);
});
test('verified Stripe webhooks alone mark payments paid and replay is idempotent',async()=>{
  const event={id:'evt_fixture_success',type:'checkout.session.completed',data:{object:{id:'cs_fixture_success',payment_status:'paid',amount_total:4500,currency:'usd',metadata:{appointmentId:appointment._id,customerId:appointment.customerId}}}};
  const payload=JSON.stringify(event),signature=stripe.webhooks.generateTestHeaderString({payload,secret:config.STRIPE_WEBHOOK_SECRET});
  assert.equal((await request(app).post('/api/payments/webhook').set('Content-Type','application/json').set('stripe-signature','invalid').send(payload)).status,400);
  assert.equal((await db.collection('appointments').findOne({_id:(await import('mongodb')).ObjectId.createFromHexString(appointment._id)})).paymentStatus,'unpaid');
  for(let i=0;i<2;i++)assert.equal((await request(app).post('/api/payments/webhook').set('Content-Type','application/json').set('stripe-signature',signature).send(payload)).status,200);
  assert.equal(await db.collection('transactions').countDocuments({stripeSessionId:'cs_fixture_success'}),1);
  assert.equal((await as(appointment.owner,'get',`/api/appointments/${appointment._id}`)).body.data.paymentStatus,'paid');
  assert.equal((await as(admin,'post','/api/transactions').send({status:'paid'})).status,404);
});
test('blocking a customer immediately rejects existing authenticated API access',async()=>{
  assert.equal((await as(admin,'patch',`/api/admin/users/${alice.user.id}/block`).send({isBlocked:true})).status,200);
  assert.equal((await as(alice,'get','/api/profile')).status,403);
  assert.equal((await as(admin,'patch',`/api/admin/users/${alice.user.id}/block`).send({isBlocked:false})).status,200);
  assert.equal((await as(alice,'get','/api/profile')).status,200);
});
test('invalid IDs, invalid dates, and inactive service bookings return clear errors',async()=>{
  assert.equal((await as(alice,'get','/api/services/invalid')).status,400);
  const input={serviceId:service,appointmentDate:'2027-02-30',timeSlot:'12:00'};assert.equal((await as(alice,'post','/api/appointments').send(input)).status,400);
  const created=await as(admin,'post','/api/admin/services').send({serviceName:'Inactive Care',category:'Spa & Massage',description:'A calming and carefully tailored treatment.',price:25,duration:30,image:'https://i.ibb.co/fixture/test.jpg',status:'inactive'});assert.equal(created.status,201);
  assert.equal((await as(alice,'post','/api/appointments').send({...input,serviceId:created.body.data._id,appointmentDate:new Date(Date.now()+10*86400000).toISOString().slice(0,10)})).status,404);
});
