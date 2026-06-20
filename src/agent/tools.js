'use strict';

const path = require('path');

let _projectPath = process.cwd();

function resolveGatewayTools() {
  try {
    return require('deepseek-web-gateway/src/tools');
  } catch {
    return require(path.join(__dirname, '../../../deepseek-web-gateway/src/tools'));
  }
}

function resolveGatewayConfig() {
  try {
    return require('deepseek-web-gateway/src/config');
  } catch {
    return require(path.join(__dirname, '../../../deepseek-web-gateway/src/config'));
  }
}

/** Set the project root used by delegated gateway tools. */
function setProjectPath(projectPath) {
  _projectPath = path.resolve(projectPath);
  resolveGatewayConfig().WORKING_DIR = _projectPath;
}

async function executeTool(name, args) {
  resolveGatewayConfig().WORKING_DIR = _projectPath;
  const { executeTool: gatewayExecute } = resolveGatewayTools();
  return gatewayExecute(name, args);
}

module.exports = { executeTool, setProjectPath };
