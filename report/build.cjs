// Inlines data.json into report.html and writes report-en.html / report-tr.html.
const fs=require('fs'),path=require('path');
const dir=__dirname;
const data=JSON.parse(fs.readFileSync(path.join(dir,'data.json'),'utf8')); // fails loudly on bad JSON
const tpl=fs.readFileSync(path.join(dir,'report.html'),'utf8');
if(!tpl.includes('/*DATA*/'))throw new Error('placeholder /*DATA*/ missing in report.html');
const json=JSON.stringify(data).replace(/</g,'\u003c');
for(const lang of ['en','tr']){
  const out=tpl.replace('/*DATA*/',()=>json).replace('<body>',`<body>\n<script>window.LANG=${JSON.stringify(lang)}</script>`);
  fs.writeFileSync(path.join(dir,`report-${lang}.html`),out);
}
const nulls=Object.entries(data.num).filter(([k,v])=>!v.calc&&v.v==null).map(([k])=>k);
for(const k of ['qa_reader','qa_judge'])if(data.meta[k]==null)nulls.push('meta.'+k);
console.log('built report-en.html, report-tr.html; pending fields: '+(nulls.length?nulls.join(', '):'none'));
