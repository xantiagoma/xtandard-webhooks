#!/usr/bin/env node
import { run } from "../dist/cli.mjs";
run(process.argv.slice(2)).then((code) => process.exit(code));
