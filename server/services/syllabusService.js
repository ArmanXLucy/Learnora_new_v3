import path from 'node:path';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { db } from '../config/firebase.js';
import { putObject } from '../config/supabaseStorage.js';

const allowed=new Set(['.pdf','.txt','.md','.docx','.jpg','.jpeg','.png']);
export function validateUpload(file){if(!file)throw new Error('Choose a syllabus file.'); const ext=path.extname(file.originalname||'').toLowerCase(); if(!allowed.has(ext))throw new Error('Supported syllabus formats: JPG, JPEG, PNG, PDF, TXT, MD and DOCX.'); if(file.size>4*1024*1024)throw new Error('Syllabus file must be 4 MB or smaller.'); return ext;}
export async function extractText(file,ext){if(['.txt','.md'].includes(ext))return file.buffer.toString('utf8').slice(0,50000);if(ext==='.pdf'){const r=await pdf(file.buffer);return (r.text||'').slice(0,50000);}if(ext==='.docx'){const r=await mammoth.extractRawText({buffer:file.buffer});return (r.value||'').slice(0,50000);}return '';}
export function imageDataUrl(file,ext){const mime=ext==='.png'?'image/png': 'image/jpeg'; return `data:${mime};base64,${file.buffer.toString('base64')}`;}
export async function storeSyllabus(uid,file,ext){const safe=(file.originalname||'syllabus').replace(/[^a-zA-Z0-9._-]/g,'_');const object=`syllabi/${uid}/${Date.now()}_${safe}`;await putObject(object,file.buffer,file.mimetype||'application/octet-stream');return object;}
export async function saveSyllabusMeta(data){const ref=db.collection('syllabi').doc();await ref.set({...data,createdAt:new Date().toISOString()});return ref.id;}
