const { Octokit } = require('@octokit/rest');
const generateReleaseNotes = require('../lib/generateReleaseNotes');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let auth = undefined;
if (process.env.GITHUB_API_TOKEN) {
  auth = process.env.GITHUB_API_TOKEN;
}

const octokit = new Octokit({
  auth,
  userAgent: 'github release notes',
  request: {
    timeout: 5000
  }
});

async function checkNotes(assert, owner, repo, from, to, fixtureName) {
  const notes = await generateReleaseNotes(octokit, owner, repo, from, to);
  const samplePath = path.join(__dirname, 'fixtures', fixtureName);
  const sampleContent = fs.readFileSync(samplePath, 'utf-8', 'r+');
  assert.ok(notes.length > 0);
  assert.equal(notes, sampleContent);
}

describe('Comparing Real Release Notes', function () {
  this.timeout(5000); 
  it('works for this repo', async function () {
    await checkNotes(
      assert,
      'jrjohnson',
      'generate-github-release-notes',
      'v1.2.1',
      'v1.3.0',
      'notes-generate.md'
    );
  });
  it('works for ilios common', async function () {
    await checkNotes(
      assert,
      'ilios',
      'common',
      'v22.0.0',
      'v22.1.0',
      'notes-common.md'
    );
  });
});
