import { adminAuth } from '../config/firebase.js';

const email=process.env.ADMIN_EMAIL;
if(!email) throw new Error('Set ADMIN_EMAIL before running this script.');
const user=await adminAuth.getUserByEmail(email);
await adminAuth.setCustomUserClaims(user.uid,{...(user.customClaims||{}),admin:true});
console.log(`Admin claim set for ${email} (${user.uid}).`);
