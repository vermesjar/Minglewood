/** Check the real Design Lab worker and read-only preview without generating or publishing art. */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = 'http://localhost:5196';
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:1440,height:1100}});
const errors: string[] = [];
page.on('pageerror',e=>errors.push(e.message));
const made = await page.request.post(`${root}/api/dev/lab/from-catalog/couch.green`,{headers:{'x-lab':'1'},data:{}});
if (!made.ok()) throw new Error(await made.text());
const draft = await made.json();
await page.request.put(`${root}/api/dev/lab/drafts/${draft.id}`,{headers:{'x-lab':'1'},data:{furniture:{...draft.furniture,seatModel:null}}});
await page.goto(`${root}/studio.html#draft/${draft.id}/furniture`);
await page.getByText('Seating checks passed in every direction.',{exact:true}).waitFor({timeout:180_000});
const panel = page.locator('.model-panel');
await panel.scrollIntoViewIfNeeded();
mkdirSync('art/review/designlab-browser',{recursive:true});
await panel.screenshot({path:'art/review/designlab-browser/couch-green.png'});
await page.waitForTimeout(800);
const saved = await (await page.request.get(`${root}/api/dev/lab/drafts/${draft.id}`)).json();
const result = {draft:draft.id, errors, compiler:saved.draft.furniture.seatModel?.model.compiler?.version,
  canvases:await panel.locator('canvas').count(), tuningInputs:await panel.locator('input[type=number]').count()};
writeFileSync('art/review/designlab-browser/report.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
await browser.close();
if(errors.length || result.canvases!==4 || !result.compiler || result.tuningInputs) process.exitCode=1;
