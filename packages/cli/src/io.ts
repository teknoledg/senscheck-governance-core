export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
}

export const defaultIo = (): Io => ({
  out: (t) => process.stdout.write(`${t}\n`),
  err: (t) => process.stderr.write(`${t}\n`),
  cwd: process.cwd(),
});
