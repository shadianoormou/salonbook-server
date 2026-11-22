import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdir } from 'node:fs/promises';
await mkdir('.cache/database',{recursive:true});
const server=await MongoMemoryReplSet.create({binary:{version:'7.0.24'},replSet:{name:'salonbook',count:1,storageEngine:'wiredTiger'},instanceOpts:[{port:27017,dbPath:'.cache/database'}]});
console.log('Local development database is ready on port 27017. Keep this process running.');
async function stop(){await server.stop();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
