const path = require('path');
const {createRequire} = require('module');
const demoRequire = createRequire(path.resolve(process.env.DEMO_DIR || '.', 'package.json'));
const {chromium} = demoRequire('playwright');
const fs = require('fs');
(async()=>{
 const phase=process.argv[2] || 'before';
 const root=path.resolve(__dirname, '..');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 await page.goto('http://127.0.0.1:9001');
 await page.locator('input[type=file]').first().setInputFiles(path.resolve(process.argv[3] || path.join(root, 'main-test.dxf')));
 await page.waitForFunction(()=>{const walk=v=>v?.dxfViewer ? v : v?.$children?.map(walk).find(Boolean); const c=walk([...document.querySelectorAll('*')].find(e=>e.__vue__)?.__vue__); if(c && !c.isLoading && c.dxfViewer.GetBounds()){window.viewer=c.dxfViewer;return true;} return false;},null,{timeout:120000});
 await page.waitForTimeout(1000); // Allow the demo's loading overlay transition to finish.
 const canvas=page.locator('canvas');
 await page.evaluate(()=>viewer.Render());
 await canvas.screenshot({path:root+'/proof/'+phase+'.png'});
 const state=await page.evaluate(()=>({origin:viewer.GetOrigin(),bounds:viewer.GetBounds(),camera:viewer.GetCamera().position.toArray(),left:viewer.GetCamera().left,right:viewer.GetCamera().right,top:viewer.GetCamera().top,bottom:viewer.GetCamera().bottom}));
 fs.writeFileSync(root+'/proof/'+phase+'-view.json',JSON.stringify(state,null,2));
 await page.evaluate(()=>{const o=viewer.GetOrigin();viewer.FitView(23.3325-o.x,27.85-o.x,31.87-o.y,36.5968-o.y,0.12);viewer.Render();});
 await canvas.screenshot({path:root+'/proof/'+phase+'-zoomed.png'});
 console.log(JSON.stringify(state));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
