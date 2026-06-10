# SeekCode

**AI Coding Orchestrator** – Project intelligence, multi-step planning, and smart code automation, powered by DeepSeek Web Gateway.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

## Overview

SeekCode is an orchestration layer that brings AI-assisted coding to your terminal. It analyzes your codebase, breaks down complex tasks into executable steps, and uses the DeepSeek Web Gateway to drive AI-powered code refactoring, planning, and execution.

## Features

- **Project Analysis** : AST-based parsing, dependency graph generation, and project metadata extraction
- **Multi-step Planning** : Decompose complex tasks into actionable, ordered steps
- **AI Orchestration** : Leverages DeepSeek Web Gateway for intelligent code generation and reasoning
- **Smart Refactoring** : Safe rename operations, find usages, and targeted code modifications
- **Test Integration** : Run and validate tests after AI-driven changes
- **Git Integration** : Automatic commits and branch management
- **Session Memory** : Cached project analysis for faster subsequent runs
- **Interactive Mode** : Chat-like interface for continuous task execution

## Prerequisites

- Node.js 18 or higher
- [DeepSeek Web Gateway](https://github.com/sarthakdev143-lite/deepseek-web-gateway) as a sibling directory (for AI capabilities)

## Installation

```bash
# Clone the repository
git clone https://github.com/sarthakdev143-lite/seekcode.git
cd seekcode

# Install dependencies
npm install

# Link globally (optional)
npm link
```

## Usage

### Interactive Mode

Simply run SeekCode without arguments to start the interactive session:

```bash
seekcode
# or
node src/seekcode.js
```

The gateway will start automatically, and you'll be dropped into a chat-like interface where you can describe tasks in natural language.

### CLI Commands

#### Analyze a Project

```bash
seekcode analyze [project-path]
```

Generates a comprehensive analysis of the project structure, dependencies, and metadata.

#### Generate a Plan

```bash
seekcode plan [project-path] "Your task description"
```

Creates a multi-step execution plan without running it.

#### Execute a Task

```bash
seekcode run [project-path] "Refactor the authentication module"
```

Analyzes the project, generates a plan, and executes it using AI.

## How It Works

1. **Project Analysis** – SeekCode scans your codebase, builds an AST, and creates a dependency graph
2. **Task Planning** – The task description is sent to DeepSeek AI via the gateway, which returns a structured plan
3. **Step Execution** – Each plan step is executed with appropriate tools (refactoring, file operations, etc.)
4. **Validation** – Tests are run to ensure changes don't break functionality
5. **Git Integration** – Successful changes can be automatically committed

## Architecture

```
seekcode/
├── src/
│   ├── analyzer/       # Project analysis (AST, deps, metadata)
│   ├── planner/        # Task decomposition and planning
│   ├── orchestrator/   # Main execution engine
│   ├── smart-tools/    # Refactoring and code manipulation
│   ├── testing/        # Test runner integration
│   ├── git/           # Git operations
│   ├── session/       # Caching and memory
│   └── commands/      # CLI command handlers
├── package.json
└── README.md
```

## Example

```bash
$ seekcode run . "Add error handling to all database queries"

[INFO] Analyzing project...
[SUCCESS] Project loaded: my-app
[INFO] Generating plan...
[INFO] Execution Plan:
  1. Identify all database query locations
  2. Add try-catch blocks to each query
  3. Implement error logging
  4. Run tests to verify changes

[AI] Refactoring src/models/user.js...
[AI] Refactoring src/models/product.js...
[SUCCESS] All changes applied
[INFO] Running tests... ✓ 12 passed
[INFO] Changes committed to git
```

## Configuration

No configuration file is required by default. The tool expects `deepseek-web-gateway` to be located in a sibling directory:

```
parent-folder/
├── seekcode/
└── deepseek-web-gateway/
```

## Development

```bash
# Run in development mode
node src/seekcode.js

# Run specific command
node src/seekcode.js analyze .
```

## Dependencies

- `commander` – CLI argument parsing
- `fast-glob` – File pattern matching
- `ignore` – .gitignore parsing
- `node-fetch` – HTTP requests to gateway
- `tree-sitter` – Fast AST parsing for JavaScript/TypeScript

## Limitations

- Currently optimized for JavaScript/TypeScript projects
- Requires DeepSeek Web Gateway running (auto-started by default)
- AI operations depend on the DeepSeek web interface availability

## Contributing

Contributions are welcome! Please ensure:
- Code passes existing tests (add new tests for features)
- Follows the existing code style
- Includes documentation for new features

## License

MIT License – see [LICENSE](LICENSE) file for details.

## Acknowledgements

- Built on [DeepSeek Web Gateway](https://github.com/sarthakdev143-lite/deepseek-web-gateway)
- Uses [tree-sitter](https://tree-sitter.github.io/) for blazing-fast parsing

## Support

For issues or questions, please [open an issue](https://github.com/yourusername/seekcode/issues) on GitHub.
