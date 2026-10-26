'use strict';
const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const FLAG='EGX_HISTORY_GUARDED_INTEGRATION';
function walk(dir){
 if(!fs.existsSync(dir)) throw new Error('Missing .github directory');
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const p=path.join(dir,e.name);
  if(e.isSymbolicLink()) throw new Error('Symlink forbidden: '+p);
  if(e.isDirectory()) return walk(p);
  if(!e.isFile()) throw new Error('Unknown filesystem entry: '+p);
  return [p];
 });
}
function visit(node,fn){
 if(!node||typeof node!=='object') return;
 if(typeof node.type==='string') fn(node);
 for(const [k,v] of Object.entries(node)){
  if(k==='start'||k==='end'||k==='loc') continue;
  if(Array.isArray(v)) v.forEach(c=>visit(c,fn));
  else if(v&&typeof v==='object') visit(v,fn);
 }
}
function staticString(node){
 if(node?.type==='Literal'&&typeof node.value==='string') return node.value;
 if(node?.type==='TemplateLiteral'&&node.expressions.length===0) return node.quasis[0].value.cooked;
 return null;
}
function isRequire(n){return n?.type==='Identifier'&&n.name==='require'}
function member(n,obj,prop){return n?.type==='MemberExpression'&&!n.computed&&n.object?.type==='Identifier'&&n.object.name===obj&&n.property?.name===prop}
function isHistory(s){return typeof s==='string'&&/(^|[\\/])history-[^\\/]+$/.test(s)}
function staticGuard(root){
 const src=fs.readFileSync(path.join(root,'scripts/stable/v16-session-aware-price-truth.cjs'),'utf8');
 const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'script',allowHashBang:true});
 const violations=[];
 if(src.includes(FLAG)) violations.push('Activation flag in producer');
 visit(ast,n=>{
  if(n.type==='Identifier'&&n.name==='require'){
   // A direct literal call is permitted only for NON-history dependencies.
   // All other uses (aliases, access, bind/call/apply, references) are forbidden.
   if(!directCalls.has(n)) violations.push('Non-direct require reference at '+n.start);
  }
  if(n.type==='CallExpression'){
   if(isRequire(n.callee)){
    if(n.arguments.length!==1||staticString(n.arguments[0])===null) violations.push('Dynamic require at '+n.start);
    else if(isHistory(staticString(n.arguments[0]))) violations.push('History require at '+n.start);
   }
   if(member(n.callee,'module','require')) violations.push('module.require at '+n.start);
  }
  if(n.type==='MemberExpression'&&member(n,'module','require')) violations.push('module.require reference at '+n.start);
  if(n.type==='Identifier'&&['eval','Function','createRequire'].includes(n.name)) violations.push('Unsafe dynamic loader at '+n.start);
  if(n.type==='ImportExpression') violations.push('Dynamic import at '+n.start);
  if(n.type==='ImportDeclaration'||n.type==='ExportNamedDeclaration'&&n.source||n.type==='ExportAllDeclaration')
    violations.push('Module import/export at '+n.start);
 });
 for(const wf of walk(path.join(root,'.github')))
  if(fs.readFileSync(wf,'utf8').includes(FLAG)) violations.push('Activation flag in '+path.relative(root,wf));
 return violations;
}
// Mark direct require callee identifiers before walking the syntax tree.
const directCalls=new WeakSet();
const originalStaticGuard=staticGuard;
function checkedGuard(root){
 const src=fs.readFileSync(path.join(root,'scripts/stable/v16-session-aware-price-truth.cjs'),'utf8');
 const ast=acorn.parse(src,{ecmaVersion:'latest',sourceType:'script',allowHashBang:true});
 visit(ast,n=>{if(n.type==='CallExpression'&&isRequire(n.callee)) directCalls.add(n.callee)});
 return originalStaticGuard(root);
}
module.exports={staticGuard:checkedGuard};
