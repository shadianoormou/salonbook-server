import Stripe from 'stripe';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';
import { createAuthentication } from './auth.js';
import { createGuards } from './middleware/authenticate.js';
import { createApp } from './app.js';
const config=readConfig();
const {db,client}=await connectDatabase(config);
const auth=createAuthentication(db,client,config);
const context={db,client,config,auth,stripe:config.STRIPE_SECRET_KEY?new Stripe(config.STRIPE_SECRET_KEY):null};
context.guards=createGuards(context);
const server=createApp(context).listen(config.PORT,()=>console.log(`SalonBook API listening on port ${config.PORT}`));
async function shutdown(){server.close(async()=>{await client.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
