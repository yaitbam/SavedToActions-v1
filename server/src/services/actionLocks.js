// One process owns this local SQLite workspace. Keep asynchronous calendar writes
// and lifecycle transitions for one action from racing with one another.
export function createActionLocks(){
 const active=new Set();
 return {isBusy:()=>active.size>0,isBusyFor:(id)=>active.has(id),async run(id,work){if(active.has(id)){const error=new Error('Another operation for this action is still running.');error.status=409;error.publicCode='operation_in_progress';throw error}active.add(id);try{return await work()}finally{active.delete(id)}}};
}
