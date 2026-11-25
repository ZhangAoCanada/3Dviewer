import { suggestGround } from '../src/game/groundSuggestions';
import { prepareSceneGeometry } from '../src/game/sceneGeometry';
import { MeshRenderable } from '../src/renderables/meshRenderable';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGroundProposalJob, type GroundProposalInput } from '../src/game/groundDetection';

function input(upHint: readonly [number,number,number]): GroundProposalInput {
  return {samples:{positions:new Float32Array([0,0,0,1,0,0,0,0,1,1,0,1]),provenance:'points'},upHint,distanceTolerance:.01,maxSamples:24000,maxHypotheses:32,maxCandidates:3,minSupport:3,seed:7};
}
function resultOf(options:GroundProposalInput) {
  const created=createGroundProposalJob(options);if(created.kind!=='job')throw new Error(created.reason);
  let status=created.job.step(10000);while(status.status!=='done')status=created.job.step(10000);return status.result;
}

describe('independent Gemini detector integration audit',()=>{
  it('normalizes every finite nonzero up hint, including tiny vectors',()=>{
    expect(createGroundProposalJob(input([0,1e-100,0])).kind).toBe('job');
    const result=resultOf(input([0,1e-100,0]));expect(result.kind).toBe('candidates');
  });
  it('does not overflow normalization of very large finite hints',()=>{
    const created=createGroundProposalJob(input([Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE]));
    expect(created.kind).toBe('job');
    const result=resultOf(input([Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE]));
    expect(result.kind).toBe('candidates');
    if(result.kind==='candidates')expect(new THREE.Vector3(...result.candidates[0].normal).length()).toBeCloseTo(1);
  });
  it('ranks candidates by the same occupied area it reports',()=>{
    const xyz:number[]=[];
    for(const x of [-50,50])for(const z of [-50,50])for(let i=0;i<30;i++)xyz.push(x+(i%5)*.01,0,z+Math.floor(i/5)*.01);
    for(let x=-10;x<10;x++)for(let z=-10;z<10;z++)xyz.push(x,10,z);
    const result=resultOf({...input([0,1,0]),samples:{positions:Float32Array.from(xyz),provenance:'points'},distanceTolerance:1,maxHypotheses:256,maxCandidates:8,minSupport:100});
    expect(result.kind).toBe('candidates');
    if(result.kind==='candidates')for(let i=1;i<result.candidates.length;i++)expect(result.candidates[i-1]?.spread??0).toBeGreaterThanOrEqual(result.candidates[i]?.spread??Infinity);
  });
});


describe('real adapter to detector runner',()=>{
  const signal=()=>new AbortController().signal;
  function scene(){
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,10).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial());
    floor.position.set(4e6,7,-3e6);
    return new MeshRenderable('floor',{fileName:'floor.obj',loaderId:'mesh',loadMs:0},floor);
  }
  it('returns centered plane proposals in world coordinates without inventing walkability',async()=>{
    const item=scene(),geometry=await prepareSceneGeometry([item],signal());
    const analysis=await suggestGround(geometry,new THREE.Vector3(0,1,0),signal());
    expect(analysis.suggestions.length).toBeGreaterThan(0);
    const first=analysis.suggestions[0];if(!first)throw new Error('Missing proposal');
    expect(first.point.y).toBeCloseTo(7,5);expect(Math.abs(first.normal.y)).toBeGreaterThan(.99);
    expect(first.point.x).toBeGreaterThan(4e6-6);expect(first.point.x).toBeLessThan(4e6+6);
    expect(first.evidence).toContain('cannot distinguish');expect(first).not.toHaveProperty('walkable');
    item.dispose();
  });
  it('keeps work cap distinct from no floor and leaves manual setup available',async()=>{
    const item=scene(),geometry=await prepareSceneGeometry([item],signal());
    const analysis=await suggestGround(geometry,new THREE.Vector3(0,1,0),signal(),{maxWork:1});
    expect(analysis.suggestions).toEqual([]);expect(analysis.message).toContain('work cap');expect(analysis.message).toContain('manual');item.dispose();
  });
  it('cancels during cooperative analysis without returning stale proposals',async()=>{
    const item=scene(),geometry=await prepareSceneGeometry([item],signal());const abort=new AbortController();
    const pending=suggestGround(geometry,new THREE.Vector3(0,1,0),abort.signal);abort.abort();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});item.dispose();
  });
  it('uses manual setup when there are no stable resident samples',async()=>{
    const item=scene(),geometry=await prepareSceneGeometry([item],signal());geometry.positions=new Float32Array();
    const result=await suggestGround(geometry,new THREE.Vector3(0,1,0),signal());expect(result.suggestions).toEqual([]);expect(result.message).toContain('Not enough');item.dispose();
  });
});
