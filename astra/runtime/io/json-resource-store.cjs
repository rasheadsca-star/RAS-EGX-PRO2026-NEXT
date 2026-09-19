'use strict';
const fs=require('fs');
const path=require('path');
function exists(file){return fs.existsSync(file)}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'))}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const next=JSON.stringify(value,null,2)+'\n';
  const tmp=`${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp,next,'utf8');
  JSON.parse(fs.readFileSync(tmp,'utf8'));
  fs.renameSync(tmp,file);
}
module.exports={exists,readJson,writeJsonAtomic};
