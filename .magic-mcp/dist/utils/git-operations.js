import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
/**
 * Execute a git command in the specified directory
 */
export async function git(cwd, args) {
    const { stdout } = await execAsync(`git ${args}`, { cwd });
    return stdout.trim();
}
