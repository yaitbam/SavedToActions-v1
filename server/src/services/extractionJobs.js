export function createExtractionJobs({db,execute,clock=Date.now}) {
  const running=new Map();
  let queue=Promise.resolve();
  // A process restart cannot truthfully resume an in-flight provider request.
  db.prepare("UPDATE extraction_jobs SET state='failed', finished_at=?, error_json=? WHERE state IN ('queued','running')").run(new Date(clock()).toISOString(),JSON.stringify({error:'extraction_interrupted',detail:'The server restarted during extraction. Retry the saved screenshot.'}));
  const view=(row)=>row?{id:row.id,saveId:row.save_id,state:row.state,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,result:row.result_json?JSON.parse(row.result_json):null,error:row.error_json?JSON.parse(row.error_json):null}:null;
  function get(id){return view(db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(id))}
  function latest(saveId){return view(db.prepare('SELECT * FROM extraction_jobs WHERE save_id=? ORDER BY id DESC LIMIT 1').get(saveId))}
  function start(saveId){
    if(running.has(saveId))return {started:false,job:latest(saveId),promise:running.get(saveId)};
    const jobId=Number(db.prepare("INSERT INTO extraction_jobs(save_id,state,created_at) VALUES (?,'queued',?)").run(saveId,new Date(clock()).toISOString()).lastInsertRowid);
    const promise=queue.then(async()=>{
      db.prepare("UPDATE extraction_jobs SET state='running', started_at=? WHERE id=?").run(new Date(clock()).toISOString(),jobId);
      let output;
      try{output=await execute(saveId)}catch(error){console.error(`extraction job ${jobId}: ${error.message}`);output={status:500,body:{error:'server_error',detail:'Extraction failed. Retry the saved screenshot.',saveId}}}
      const success=output.status>=200&&output.status<300;
      db.prepare('UPDATE extraction_jobs SET state=?,finished_at=?,result_json=?,error_json=? WHERE id=?').run(success?'done':'failed',new Date(clock()).toISOString(),success?JSON.stringify(output.body):null,success?null:JSON.stringify(output.body),jobId);
      return output;
    }).finally(()=>running.delete(saveId));
    queue=promise.catch(()=>{});
    running.set(saveId,promise);
    return {started:true,job:get(jobId),promise};
  }
  return {start,get,latest,isBusy:()=>running.size>0,isRunning:(saveId)=>running.has(saveId)};
}
