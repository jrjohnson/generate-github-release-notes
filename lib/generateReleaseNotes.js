const debug = require('debug')('generate-release-notes');
const Handlebars = require('handlebars');
const fs = require('mz/fs');
const path = require('path');
const { filter } = require('rsvp');

const getTagInfo = async (octokit, owner, repo, tag) => {
  debug(`Getting info for the ${tag} tag in ${owner}/${repo}`);
  try {
    const tags = await octokit.paginate(
      octokit.repos.listTags,
      { owner, repo, namespace: 'tags/' }
    );

    if (tags.length === 0) {
      throw new Error(`${owner}:${repo} has no tags.`);
    }
    const ourTag = tags.find(obj => obj.name === tag);
    if (!ourTag) {
      throw new Error(`${tag} does not exist in ${owner}:${repo}`);
    }
    const { name, commit } = ourTag;
    debug(`Found tag ${name} with hash ${commit.sha}`);
  
    const tagCommit = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: commit.sha
    });
  
    const { date } = tagCommit.data.committer;
    debug(`${name} is from ${date}`);
  
    return {name, date};
  } catch (e) {
    if (e.status === 404) {
      throw new Error('This repository does not exist.');
    }

    throw new Error(e.message);
  }
  
};

const getClosedIssues = async (octokit, owner, repo, since, until) => {
  const q = `repo:${owner}/${repo} closed:${since}..${until}`;
  // q=GitHub+Octocat+in:readme+user:defunkt
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

const generateReleaseNotes = async (octokit, owner, repo, sinceTagName, releaseTagName) => {
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
  const template = await fs.readFile(path.join(__dirname, '../templates/release-notes.hbs'));
  const hbs = Handlebars.compile(template.toString());
  const repositoryUrl = `https://github.com/${owner}/${repo}`;
  const markdown = hbs({dependencies, pullRequests, bugs, enhancements, remaining, releaseTagName, sinceTagName, repositoryUrl});

  return markdown;
};

module.exports = generateReleaseNotes;
