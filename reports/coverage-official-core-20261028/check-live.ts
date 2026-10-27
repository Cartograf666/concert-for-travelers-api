/** Run from repo root: node --import tsx reports/coverage-official-core-20261028/check-live.ts */
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfigs,runScraper} from '../../src/engine/runner.js';
import {processConcerts} from '../../src/pipeline/process.js';

async function main() {
  const ids=['artist-hard-ons','artist-godspeed-you-black-emperor','artist-paula-fernandes'];
  const configs=(await loadConfigs('scrapers/artists')).filter(c=>ids.includes(c.id));
  if(configs.length!==3) throw new Error('normal loader did not discover all owned configs');
  const checkedAt=new Date().toISOString();
  const results=[];
  for(const config of configs) {
    const result=await runScraper(config);
    console.log(config.id,result.success,result.concerts.length,result.error??'');
    results.push(result);
  }
  const raw=results.flatMap(r=>r.concerts);
  let diagnostics;
  const actual=await processConcerts([...raw,...raw],'data/artists',checkedAt,undefined,d=>{diagnostics=d;});
  await writeFile('reports/coverage-official-core-20261028/real-db-process.json',JSON.stringify({checkedAt,inputRows:raw.length*2,processed:actual,diagnostics},null,2)+'\n');
  if(actual.length!==34) throw new Error('real approved artist DB processing incomplete');
  const scratch=await mkdtemp(join(tmpdir(),'official-core-live-'));
  try {
    const approved=join(scratch,'artists.json');
    await writeFile(approved,JSON.stringify(configs.map(c=>({name:c.selectors?.artistNameFallback}))));
    const processed=await processConcerts([...raw,...raw],approved,checkedAt);
    await writeFile('reports/coverage-official-core-20261028/live-output.json',JSON.stringify({checkedAt,configs,results,processed},null,2)+'\n');
    if(results.some(r=>!r.success)||processed.length!==34) throw new Error('live or processing check incomplete');
  } finally {await rm(scratch,{recursive:true,force:true});}
  // The authoritative target file is a read-only input; never a source for events.
  const csv=await readFile('/Users/alex/code/concert-for-travelers-api/reports/coverage-20261028/confirmed-missing.csv','utf8');
  const lines=csv.trim().split(/\r?\n/);
  const subset=lines.slice(1).filter(line=>/^(Hard-Ons|Godspeed You! Black Emperor|Paula Fernandes),/.test(line));
  if(subset.length!==29) throw new Error('authoritative target subset changed');
  const statuses=subset.map(line=>{
    const [artist,date]=line.split(',');
    const row=raw.find(r=>r.artist===artist&&r.date===date);
    if(!row) throw new Error(`unrecovered ${artist} ${date}`);
    return {artist,date,status:'fresh_live_recovered',sourceCity:row.city,sourceVenue:row.venue,sourceCountry:row.country};
  });
  await writeFile('reports/coverage-official-core-20261028/expected-target-subset.csv',[lines[0],...subset].join('\n')+'\n');
  await writeFile('reports/coverage-official-core-20261028/target-results.json',JSON.stringify(statuses,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
