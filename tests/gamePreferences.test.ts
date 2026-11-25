import {describe,it,expect,vi,afterEach} from 'vitest';
import {defaultPreferences,parsePreferences,readPreferences,savePreferences} from '../src/game/preferences';
afterEach(()=>vi.unstubAllGlobals());
describe('bounded independent FPS preferences',()=>{
 it('accepts exact finite versioned preferences without mutating old viewer preferences',()=>{
  const p={version:1,speed:2,sensitivity:.7,reducedMotion:true};expect(parsePreferences(p)).toEqual({speed:2,sensitivity:.7,reducedMotion:true});
  const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>saved.get(k),setItem:(k:string,v:string)=>saved.set(k,v)});savePreferences(parsePreferences(p)!);expect(readPreferences()).toEqual(parsePreferences(p));expect([...saved.keys()]).toEqual(['omniview-fps-preferences-v1']);
 });
 it.each([null,[],{},1,{version:2,speed:1,sensitivity:1,reducedMotion:false},{version:1,speed:NaN,sensitivity:1,reducedMotion:false},{version:1,speed:5,sensitivity:1,reducedMotion:false},{version:1,speed:1,sensitivity:Infinity,reducedMotion:false},{version:1,speed:1,sensitivity:.01,reducedMotion:false},{version:1,speed:1,sensitivity:1,reducedMotion:'false'}])('rejects malformed settings %j',v=>expect(parsePreferences(v)).toBeNull());
 it('corrupt/unavailable storage cannot prevent controls; respects system reduced motion',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true}));vi.stubGlobal('localStorage',{getItem:()=>'{',setItem:()=>{throw Error('blocked');}});expect(readPreferences()).toEqual(defaultPreferences());expect(()=>savePreferences(defaultPreferences())).not.toThrow();
 });
});
