import { DocConfig, DocUpdateConfig } from "./types";



export const defaultConfig: Required<DocConfig> = {
  docsPath: "docs",
  isMonorepo: true,
  docsRepoOwner: "piccolojnr",
  docsRepoName: "resell",
  docsBranch: "main",
  fileTypes: [".mdx", ".md"],
  // its a laravel project with inertia and react so ignore all the necessary paths
  // Ignore all unnecessary Laravel, Inertia, and React paths
  ignorePaths: [
    "yarn.lock",
    "node_modules",
    "public",
    "storage",
    "bootstrap",
    "config",
    "database",
    'docs',
    "tests",
    "resources",
    "artisan",
    "server.php",
    "composer.json",
    "composer.lock",
    "package.json",
    "package-lock.json",
    "tailwind.config.js",
    "webpack.mix.js",
    "webpack.config.js",
    "postcss.config.js",
    "babel.config.js",
    "jest.config.js",
    "phpunit.xml",
    "phpunit.xml.dist",
    "phpcs.xml",
    "phpcs.xml.dist",
    "phpstan.neon",
    "phpstan.neon.dist",
  ],
  createNewPr: true,
  labels: ["documentation"],
  styleGuide: "",
  importantPatterns: [
    'resources/js/contexts/**',
    "app/Console/**",
    "app/Events/**",
    "app/Mail/**",
    "app/Models/**",
    "app/Notifications/**",
    "app/Services/**",
    "app/Http/Controllers/**",
    "app/Http/Middleware/**",
    "app/Http/Resources/**",
    'resources/js/lib/**',
    'resources/js/hooks/**',
  ],
  ignorePatterns: [
    "app/Http/Controllers/Auth/**",
    "yarn.lock",
    "node_modules",
    "public",
    "storage",
    "bootstrap",
    "config",
    "database",
    'docs',
    "tests",
    "resources",
    "artisan",
    "server.php",
    "composer.json",
    "composer.lock",
    "package.json",
    "package-lock.json",
    "tailwind.config.js",
    "webpack.mix.js",
    "webpack.config.js",
    "postcss.config.js",
    "babel.config.js",
    "jest.config.js",
    "phpunit.xml",
    "phpunit.xml.dist",
    "phpcs.xml",
    "phpcs.xml.dist",
    "phpstan.neon",
    "phpstan.neon.dist",
  ],
};

// parse important patterns to include all subdirectories
const parseImportantPatterns = (patterns: string[]): string[] => {
  return [... new Set(patterns.reduce((acc: string[], pattern: string): string[] => {
    return [
      ...acc,
      ...pattern.split("/").reduce((acc: string[], part: string, index: number): string[] => {
        if (acc.length > 0) {
          return [...acc, `${acc[acc.length - 1]}/${part}`];
        } else {
          return [...acc, part];
        }
      }, [] as string[]),
    ];
  }, [] as string[]))];
}

export function createFullConfig(
  userConfig: Partial<DocConfig>
): DocUpdateConfig {
  const config = { ...defaultConfig, ...userConfig };
  // if an ignored pattern is in the important patterns, remove it from the ignore patterns
  const importantPatterns = parseImportantPatterns(config.importantPatterns)
  const ignorePatterns = parseImportantPatterns(config.ignorePatterns).map((pattern) => {
    if (importantPatterns.includes(pattern)) {
      return null;
    }
    return pattern;
  }).filter((pattern) => pattern !== null) as string[];


  return {
    docsPath: config.docsPath,
    docsRepo: config.docsRepoOwner
      ? {
        owner: config.docsRepoOwner,
        repo: config.docsRepoName || "",
        branch: config.docsBranch,
        monorepo: config.isMonorepo,
      }
      : undefined,
    matchRules: {
      docExtensions: config.fileTypes,
      ignorePatterns,
      importantPatterns,
    },
    prConfig: {
      updateOriginalPr: !config.createNewPr,
      branchPrefix: "docs/update",
      titleTemplate: "📚 Update documentation for {prTitle}",
      bodyTemplate: `This PR updates documentation to reflect changes in #{prNumber}

## Changes
{changes}

This PR was automatically generated using [SpinAI](https://github.com/Fallomai/spinai).`,
      labels: config.labels,
    },
    llmConfig: config.styleGuide
      ? {
        styleGuide: config.styleGuide,
        temperature: 0.3,
      }
      : undefined,
  };
}
