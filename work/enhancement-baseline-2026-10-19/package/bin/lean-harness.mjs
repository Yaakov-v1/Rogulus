#!/usr/bin/env node
import { main } from '../dist/cli.js';
try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) { console.error(`lean-harness: ${error.message}`); process.exitCode = 1; }
