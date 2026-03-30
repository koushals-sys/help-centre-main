#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');
const API_BASE = 'https://api.webflow.com/v2';
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
function requireEnv(v,n){if(!v){console.error(`Missing env var: ${n}`);process.exit(1);}return v}
function httpRequest(urlString,{method='GET',body,headers={}}={}){return new Promise((resolve,reject)=>{const url=new URL(urlString);const opts={method,hostname:url.hostname,path:url.pathname+(url.search||''),port:url.port||443,headers:{Authorization:`Bearer ${requireEnv(API_TOKEN,'WEBFLOW_API_TOKEN')}`,'accept-version':'2.0.0','content-type':'application/json',...headers}};const req=https.request(opts,res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300) return reject(new Error(`Webflow API ${res.statusCode}: ${data}`));try{resolve(JSON.parse(data))}catch(e){resolve(data)}})});req.on('error',reject);if(body)req.write(body);req.end()})}
async function main(){requireEnv(API_TOKEN,'WEBFLOW_API_TOKEN');requireEnv(COLLECTION_ID,'WEBFLOW_ARTICLES_COLLECTION_ID');const slug=process.argv[2]||'appointment-booking-commercial-insurance-pay-with-referral-physician-options';const listUrl=`${API_BASE}/collections/${COLLECTION_ID}/items?limit=200`;const data=await httpRequest(listUrl);const items=data?.items||data?.collectionItems||[];const item=items.find(i=> (i.fieldData && (i.fieldData.slug===slug))||i.slug===slug);if(!item){console.log('Item not found');process.exit(0);}console.log(JSON.stringify(item.fieldData,null,2))}
main().catch(err=>{console.error(err.message||err);process.exit(1)});
