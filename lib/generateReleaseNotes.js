import debugModule from 'debug';
import Handlebars from 'handlebars';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { filter } from 'rsvp';

const debug = new debugModule('generate-release-notes');

const getTagInfo = async (octokit, owner, repo, tag) => {
  debug(`Getting info for the ${tag} tag in ${owner}/${repo}`);
  try {
    const ref = await octokit.git.getRef({
      owner,
      repo,
      ref: `tags/${tag}`,
    });
    if (!ref) {
      throw new Error(`${tag} does not exist in ${owner}:${repo}`);
    }
    const ourTag = await octokit.git.getTag({
      owner,
      repo,
      tag_sha: ref.data.object.sha
    });
    const commit = ourTag.data.object;

    debug(`Found tag ${tag} with hash ${commit.sha}`);
  
    const tagCommit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: commit.sha
    });
  
    const { date } = tagCommit.data.committer;
    debug(`${tag} is from ${date}`);
  
    return {tag, date};
  } catch (e) {
    if (e.status === 404) {
      throw new Error('This repository does not exist.');
    }

    throw new Error(e.message);
  }
  
};

const getClosedIssues = async (octokit, owner, repo, since, until) => {
  const q = `repo:${owner}/${repo} closed:${since}..${until}`;
  const result = await octokit.search.issuesAndPullRequests({
    q,
    sort: 'updated',
  });
  const issues = result.data.items;
  debug(`Found ${issues.length} issues`);

  const labelArrays = issues.map(obj => obj.labels);
  let labels = [];
  for (let i = 0; i < labelArrays.length; i++) {
    const arr = labelArrays[i];
    const names = arr.map(obj => obj.name);
    labels = labels.concat(names);
  }
  const minimalIssues = issues.map(({title, number, html_url, labels, user, closed_at, pull_request = false}) => {
    const labelTitles = labels.map(obj => obj.name);
    let minimalUser = null;
    if (user) {
      minimalUser = {
        login: user.login,
        url: user.html_url
      };
    }
    return {title, number, url: html_url, pull_request, user: minimalUser, labels: labelTitles, closed_at};
  });
  const sinceDate = new Date(since);
  const skippedIssues = await filter(minimalIssues, async ({pull_request, number, labels, closed_at}) => {
    let isMergedOrNotAPullRequest = true;
    if (pull_request) {
      try {
        await octokit.pulls.checkIfMerged({ owner, repo, pull_number: number });
      } catch (e) {
        if (e.status === 404) {
          isMergedOrNotAPullRequest = false;
        }
      }
    }
    const closedAt = new Date(closed_at);

    return  closedAt > sinceDate &&
            isMergedOrNotAPullRequest &&
           !labels.includes('duplicate') &&
           !labels.includes('wontfix/works for me')
    ;
  });
  const dependencies = skippedIssues.filter(obj => obj.labels.includes('dependencies'));
  const pullRequests = skippedIssues.filter(obj => obj.pull_request && !dependencies.includes(obj));
  const bugs = skippedIssues.filter(obj => obj.labels.includes('bug') && !pullRequests.includes(obj) && !dependencies.includes(obj));
  const enhancements = skippedIssues.filter(obj => obj.labels.includes('enhancement') && !bugs.includes(obj) && !pullRequests.includes(obj) && !dependencies.includes(obj));
  const remaining = skippedIssues.filter(obj => !dependencies.includes(obj) && !pullRequests.includes(obj) && !bugs.includes(obj) && !enhancements.includes(obj));

  return { dependencies, pullRequests, bugs, enhancements, remaining };
};

export default  async function(octokit, owner, repo, sinceTagName, releaseTagName){
  debug(`Creating ${releaseTagName} release notes for ${owner}/${repo} at ${releaseTagName}`);
  const { date: sinceTagDate } = await getTagInfo(octokit, owner, repo, sinceTagName);
  let releaseTagDate;
  try {
    const { date } = await getTagInfo(octokit, owner, repo, releaseTagName);
    releaseTagDate = date;
  } catch (e) {
    //if that release doesn't exist then use todays date
    const now = new Date();
    releaseTagDate = now.toISOString().slice(0, -5) + 'Z'; //slice off milliseconds, github doesn't accept them
  }
  const {dependencies, pullRequests, bugs, enhancements, remaining} = await getClosedIssues(octokit, owner, repo, sinceTagDate, releaseTagDate);

  const templatePath = fileURLToPath(new URL('../templates/release-notes.hbs', import.meta.url));
  const template = await fs.readFile(templatePath);
  const hbs = Handlebars.compile(template.toString());
  const repositoryUrl = `https://github.com/${owner}/${repo}`;
  const markdown = hbs({dependencies, pullRequests, bugs, enhancements, remaining, releaseTagName, sinceTagName, repositoryUrl});

  return markdown;
}

