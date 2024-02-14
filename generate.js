import meow from 'meow';
import { Octokit } from '@octokit/rest';
import generateReleaseNotes from './lib/generateReleaseNotes.js';

const cli = meow(`
  Usage
    $ generate-github-release-notes <owner> <repository> <since-tag> <release-tag>

  Options
    --github-api-token, Token to use when connecting to the github API

  Examples
    $ generate-github-release-notes jrjohnson generate-github-release-notes 1.0.1 2.0.0
`,
{
  booleanDefault: undefined,
  importMeta: import.meta,
  flags: {
    githubApiToken: {
      type: 'string',
    },
  }
}
);

if (cli.input.length < 4) {
  cli.showHelp();
}
const owner = cli.input[0];
const repository = cli.input[1];
const sinceTag = cli.input[2];
const releaseTag = cli.input[3];

let auth = undefined;
if (cli.flags.githubApiToken) {
  auth = cli.flags.githubApiToken;
}

const octokit = new Octokit({
  auth,
  userAgent: 'github release notes',
  request: {
    timeout: 5000
  }
});

generateReleaseNotes(octokit, owner, repository, sinceTag, releaseTag).then(releaseNotes => {
  process.stdout.write(releaseNotes);
  process.exit(0);
});
