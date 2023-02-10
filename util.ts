export async function assureSuccess(process: Deno.Process) {
  if (!(await process.status()).success) {
    throw new Error("failed");
  }
}
