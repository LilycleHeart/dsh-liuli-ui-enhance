import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { liuliCss } from '../src/client/liuli-css.ts'
import { pluginManagerLayoutCss } from '../src/client/plugin-manager-layout.ts'
import { officialMaterialGapsCss } from '../src/client/official-material-gaps.ts'

const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
test('global pages retain a full body card and one aligned search field at wide and narrow widths', {skip:!existsSync(chrome)}, async () => {
  const root=await mkdtemp(join(tmpdir(),'liuli-pages-layout-'))
  try {
    const require=createRequire(import.meta.url)
    const primitiveRoot=dirname(require.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json'))
    const inputCss=await readFile(join(primitiveRoot,'lib/Input.module.css'),'utf8')
    const file=join(root,'check.html')
    // Match the target host's direct installedPanel and Input icon/wrap/input hierarchy.
    await writeFile(file,`<!doctype html><meta charset="utf-8"><style>
      body{margin:0;--liuli-dock-padding:8px;--liuli-window-radius:14px;--liuli-radius-sm:10px;--liuli-acrylic-rgb:40,45,50;--liuli-material-opacity:.55;--liuli-material-blur:blur(6px);--liuli-material-blur-strong:blur(12px);--liuli-noise:none;--dsw-alias-border-l1:rgba(255,255,255,.2);--dsw-alias-border-l2:rgba(255,255,255,.3)}
      [data-plugin-panel]{display:flex;flex-direction:column;box-sizing:border-box;width:1100px;height:480px}
      header{display:flex}.host_installedPanel{display:flex;flex-direction:column;gap:24px}
      [data-plugin-group]{height:110px}[data-testid='task-manager-page']{display:flex;width:970px}
      .host_listPane{flex:1;min-width:0}.host_pageContent{padding:24px;box-sizing:border-box}
      .host_searchField{display:flex;align-items:center;height:36px;border:.5px solid;padding:0 10px}
      .host_searchClear{flex:none;width:28px;height:28px;padding:0}
      ${inputCss}
      ${liuliCss.replace(/@import[^;]+;/g,'')}
      ${pluginManagerLayoutCss}
      ${officialMaterialGapsCss}
    </style>
    <section data-plugin-panel><header data-window-drag>Plugins</header><div class="host_installedPanel"><section data-plugin-group>Built in</section><section data-plugin-group>Installed</section></div></section>
    <section data-testid="task-manager-page"><div class="host_listPane"><div class="host_pageContent"><div class="host_searchField"><span class="_wrap_14sgc_1"><span class="_icon_14sgc_16"><svg width="16" height="16"></svg></span><input class="_input_14sgc_25" type="search" placeholder="搜索自动化任务"></span><button class="host_searchClear" aria-label="清除">×</button></div></div></div></section>
    <pre id="result"></pre><script>
      const body=document.querySelector('.host_installedPanel'), material=getComputedStyle(body,'::before');
      const card={background:material.backgroundColor,border:getComputedStyle(body).borderTopWidth,radius:getComputedStyle(body).borderTopLeftRadius,height:body.getBoundingClientRect().height};
      const page=document.querySelector('[data-testid="task-manager-page"]'),input=page.querySelector('input'),icon=input.previousElementSibling,field=input.parentElement.parentElement;
      const widths=[];
      for(const width of [970,320]){
        page.style.width=width+'px';const f=field.getBoundingClientRect(),i=icon.getBoundingClientRect(),r=input.getBoundingClientRect();
        widths.push({width,height:f.height,centered:Math.abs((i.top+i.height/2)-(f.top+f.height/2))<1,inputInside:r.right<=f.right&&r.left>=i.right,overflow:page.scrollWidth>width,innerBorder:getComputedStyle(input.parentElement).borderTopWidth});
      }
      document.querySelector('#result').textContent=JSON.stringify({card,widths});
    </script>`)
    const result=spawnSync(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-proxy-server',`--user-data-dir=${join(root,'browser')}`,'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024})
    assert.equal(result.status,0,result.stderr)
    const data=JSON.parse(result.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1]??'null')
    assert.ok(data,'browser returned layout measurements')
    assert.notEqual(data.card.background,'rgba(0, 0, 0, 0)')
    assert.equal(data.card.border,'1px')
    assert.equal(data.card.radius,'14px')
    assert.ok(data.card.height>300,'body card fills the space below the header')
    for(const row of data.widths){
      assert.equal(row.height,40)
      assert.equal(row.centered,true)
      assert.equal(row.inputInside,true)
      assert.equal(row.overflow,false)
      assert.equal(row.innerBorder,'0px')
    }
  } finally {
    assert.equal(dirname(resolve(root)),resolve(tmpdir()))
    assert.ok(basename(root).startsWith('liuli-pages-layout-'))
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200})
  }
})
