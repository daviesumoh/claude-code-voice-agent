import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execAsync = promisify(exec);

export class SymbolIndexer {
  private cachedKeyterms: string[] = [];

  async indexWorkspace(cwd: string): Promise<string[]> {
    if (!cwd || !fs.existsSync(cwd)) {
      return this.cachedKeyterms;
    }

    const keytermsSet = new Set<string>();

    // 1. Inspect package.json if present
    try {
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) keytermsSet.add(pkg.name);
        if (pkg.dependencies) {
          for (const dep of Object.keys(pkg.dependencies)) {
            // e.g. @anthropic-ai/claude-agent-sdk -> claude-agent-sdk
            const cleanDep = dep.replace(/^@[^/]+\//, '');
            keytermsSet.add(cleanDep);
          }
        }
        if (pkg.devDependencies) {
          for (const dep of Object.keys(pkg.devDependencies)) {
            const cleanDep = dep.replace(/^@[^/]+\//, '');
            keytermsSet.add(cleanDep);
          }
        }
      }
    } catch {
      // Ignore package.json read errors
    }

    // 2. Query git for tracked and modified files
    try {
      const { stdout } = await execAsync('git ls-files -m -o --exclude-standard | head -n 40', {
        cwd,
        timeout: 1000,
      });

      const files = stdout.split('\n').filter(Boolean);
      for (const file of files) {
        const basename = path.basename(file, path.extname(file));
        if (basename.length > 2 && basename.length < 30) {
          keytermsSet.add(basename);
        }
      }
    } catch {
      // Not a git repo or git timed out, fallback to reading directory entries
      try {
        const entries = fs.readdirSync(cwd).slice(0, 30);
        for (const entry of entries) {
          if (!entry.startsWith('.')) {
            const basename = path.basename(entry, path.extname(entry));
            if (basename.length > 2) keytermsSet.add(basename);
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    // Filter and take top 50
    this.cachedKeyterms = Array.from(keytermsSet)
      .filter((term) => term.length >= 3 && term.length <= 40)
      .slice(0, 50);

    return this.cachedKeyterms;
  }

  getKeyterms(): string[] {
    return this.cachedKeyterms;
  }
}

