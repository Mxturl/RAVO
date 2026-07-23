#!/usr/bin/env node

"use strict";

const implementation = require("../../ravo/modules/ravo-core/scripts/ravo-goal-prompt");

if (require.main === module) implementation.main();

module.exports = implementation;
