// gather-accessibility-issues.js

const { Octokit } = require('@octokit/rest');
const { stringify } = require('csv-stringify');
const fs = require('fs');
const minimist = require('minimist');

// --- Configuration ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Get token from environment variable
const DEFAULT_PRIMARY_LABEL = 'accessibility'; // New default label
const WCAG_PATTERNS = [
    /WCAG\s*([0-9\.]+)\s*(A{1,3})/gi, // e.g., WCAG 2.1 AA, WCAG 2.0 A
    /SC\s*([0-9\.]+)/gi,             // e.g., SC 1.3.1
    /\b([0-9]+\.[0-9]+\.[0-9]+)\b/g, // e.g., 1.1.1, 2.4.4 (general pattern for success criteria)
    /AA/gi,                          // Just "AA"
    /A/gi                            // Just "A"
];

// --- Initialize Octokit ---
if (!GITHUB_TOKEN) {
    console.error('Error: GITHUB_TOKEN environment variable not set.');
    console.error('Please generate a GitHub Personal Access Token (PAT) with "repo" scope and set it as GITHUB_TOKEN.');
    console.error('Example: export GITHUB_TOKEN="YOUR_PAT_HERE"');
    process.exit(1);
}

const octokit = new Octokit({
    auth: GITHUB_TOKEN,
    log: {
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error
    }
});

// --- Helper Functions ---

/**
 * Searches text for WCAG SC patterns and returns unique matches.
 * @param {string} text - The text to search within.
 * @returns {string[]} An array of unique WCAG SC strings found.
 */
function findWcagScInText(text) {
    const foundSc = new Set();
    if (!text) return [];

    WCAG_PATTERNS.forEach(pattern => {
        let match;
        // Reset lastIndex for global regexes before each new test
        pattern.lastIndex = 0;
        while ((match = pattern.exec(text)) !== null) {
            if (match[0]) {
                foundSc.add(match[0].toUpperCase().replace(/\s+/g, ' ').trim());
            }
        }
    });
    return Array.from(foundSc);
}

/**
 * Fetches all items (e.g., issues, repositories) from a paginated GitHub API endpoint.
 * @param {function} apiCall - The Octokit API method to call (e.g., octokit.repos.listForOrg).
 * @param {object} params - Initial parameters for the API call.
 * @returns {Array} An array of all fetched items.
 */
async function fetchAllPages(apiCall, params) {
    let allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        try {
            const response = await apiCall({ ...params, page, per_page: 100 });
            if (response.data && response.data.length > 0) {
                allItems = allItems.concat(response.data);
                // GitHub API uses 'link' header for pagination. Octokit handles it,
                // but checking response.data.length is a simple way to know when no more data.
                // A more robust check might involve checking response.headers.link for 'next'
                if (response.data.length < 100) { // If less than per_page, assume last page
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        } catch (error) {
            if (error.status === 404) {
                 console.warn(`Warning: Repository not found or no access for ${params.owner}/${params.repo}. Skipping.`);
                 hasMore = false;
            } else if (error.status === 403 && error.response && error.response.headers && error.response.headers['x-ratelimit-remaining'] === '0') {
                const resetTime = new Date(parseInt(error.response.headers['x-ratelimit-reset']) * 1000);
                console.error(`Rate limit exceeded! Please wait until ${resetTime.toLocaleTimeString()} before trying again.`);
                process.exit(1); // Exit on rate limit
            } else {
                console.error(`Error fetching page ${page}:`, error.message);
            }
            hasMore = false; // Stop on error
        }
    }
    return allItems;
}

// --- Main Script Logic ---

async function gatherAccessibilityIssues(orgName, primaryLabel, additionalLabels) {
    console.log(`Scanning GitHub organization: ${orgName}`);
    console.log(`Looking for issues with primary label: "${primaryLabel}"`);
    if (additionalLabels.length > 0) {
        console.log(`Also including issues with additional labels: "${additionalLabels.join('", "')}"`);
    }

    const issuesData = [];
    const processedIssueIds = new Set();

    // CSV Headers
    const csvHeaders = [
        "WCAG SC", "Issue ID", "Issue Title", "Issue URL", "Project",
        "Status", "Priority", "Component", "Version", "Reporter",
        "Created", "Updated", "Comments", "Has Fork", "Last Commenter", "Extracted At"
    ];

    // 1. Get all repositories for the organization
    console.log('Fetching repositories...');
    const repositories = await fetchAllPages(octokit.repos.listForOrg, { org: orgName, type: 'public' });
    if (repositories.length === 0) {
        console.log(`No public repositories found for ${orgName} or access denied. Exiting.`);
        return;
    }
    console.log(`Found ${repositories.length} repositories.`);

    for (const repo of repositories) {
        process.stdout.write(`Processing repository: ${repo.full_name}... `); // Use process.stdout.write for in-line progress
        const repoIssues = await fetchAllPages(octokit.issues.listForRepo, {
            owner: repo.owner.login,
            repo: repo.name,
            state: 'all' // Get both open and closed issues
        });
        console.log(`Found ${repoIssues.length} issues.`);

        for (const issue of repoIssues) {
            // Skip pull requests (issues API returns PRs too)
            if (issue.pull_request) {
                continue;
            }

            if (processedIssueIds.has(issue.id)) {
                continue;
            }
            processedIssueIds.add(issue.id);

            // Check if issue has any of the specified labels
            const issueLabels = issue.labels.map(label => label.name.toLowerCase());
            const hasRelevantLabel = issueLabels.includes(primaryLabel.toLowerCase()) ||
                                     additionalLabels.some(label => issueLabels.includes(label.toLowerCase()));

            // Check if keyword "accessibility" is in title or body
            const isKeywordFoundInText = issue.title.toLowerCase().includes('accessibility') ||
                                         (issue.body && issue.body.toLowerCase().includes('accessibility'));

            // Include issue if it has a relevant label OR contains the keyword "accessibility"
            if (!hasRelevantLabel && !isKeywordFoundInText) {
                continue;
            }

            let lastCommenter = null;
            let wcagScFound = [];

            // Fetch comments for WCAG SC detection and last commenter
            if (issue.comments > 0) {
                try {
                    const comments = await fetchAllPages(octokit.issues.listComments, {
                        owner: repo.owner.login,
                        repo: repo.name,
                        issue_number: issue.number
                    });
                    if (comments.length > 0) {
                        lastCommenter = comments[comments.length - 1].user ? comments[comments.length - 1].user.login : 'N/A';
                        comments.forEach(comment => {
                            wcagScFound = wcagScFound.concat(findWcagScInText(comment.body));
                        });
                    }
                } catch (commentError) {
                    console.warn(`Warning: Could not fetch comments for issue ${issue.html_url}: ${commentError.message}`);
                }
            }

            // Also check issue body and title for WCAG SC
            wcagScFound = wcagScFound.concat(findWcagScInText(issue.body));
            wcagScFound = wcagScFound.concat(findWcagScInText(issue.title));
            wcagScFound = [...new Set(wcagScFound)]; // Deduplicate WCAG SC found

            issuesData.push({
                "WCAG SC": wcagScFound.length > 0 ? wcagScFound.join('; ') : null, // Use null if no SC found
                "Issue ID": `${repo.name}-${issue.number}`,
                "Issue Title": issue.title,
                "Issue URL": issue.html_url,
                "Project": repo.name,
                "Status": issue.state,
                "Priority": null,
                "Component": null,
                "Version": null,
                "Reporter": issue.user ? issue.user.login : 'N/A',
                "Created": issue.created_at,
                "Updated": issue.updated_at,
                "Comments": issue.comments,
                "Has Fork": repo.fork ? 'Yes' : 'No',
                "Last Commenter": lastCommenter,
                "Extracted At": new Date().toISOString()
            });
        }
    }

    console.log(`\nFound ${issuesData.length} accessibility-related issues across ${repositories.length} repositories.`);

    // 2. Write to CSV
    const filename = `${orgName}-accessibility-issues-${new Date().toISOString().slice(0, 10)}.csv`;
    stringify(issuesData, { header: true, columns: csvHeaders }, (err, output) => {
        if (err) {
            console.error('Error writing CSV:', err);
            return;
        }
        fs.writeFile(filename, output, (err) => {
            if (err) {
                console.error('Error saving CSV file:', err);
                return;
            }
            console.log(`CSV file "${filename}" created successfully.`);
        });
    });
}

// --- Command Line Argument Parsing and Help ---

const showHelp = () => {
    console.log(`
Usage: node gather-accessibility-issues.js -r <github_organization_name> [options]

Options:
  -r, --repo <organization_name>   Required. The GitHub organization to scan (e.g., localgovdrupal).
  -l, --label <label_name>         Optional. The primary label to scan for (default: "${DEFAULT_PRIMARY_LABEL}").
  -a, --additional-labels <label1,label2,...>
                                   Optional. Comma-separated list of additional labels to include.
  -h, --help                       Show this help message and exit.

Examples:
  node gather-accessibility-issues.js -r localgovdrupal
  node gather-accessibility-issues.js --repo your-org --label bug --additional-labels "critical,p1"
  node gather-accessibility-issues.js -r another-org -l atag
  node gather-accessibility-issues.js -h
`);
};

const argv = minimist(process.argv.slice(2));

if (argv.h || argv.help) {
    showHelp();
    process.exit(0);
}

const organization = argv.r || argv.repo;
const primaryLabel = argv.l || argv.label || DEFAULT_PRIMARY_LABEL;
const additionalLabelsString = argv.a || argv['additional-labels'];
const additionalLabels = additionalLabelsString ? additionalLabelsString.split(',').map(s => s.trim()) : [];

if (!organization) {
    console.error('Error: GitHub organization name is required.');
    showHelp();
    process.exit(1);
}

gatherAccessibilityIssues(organization, primaryLabel, additionalLabels).catch(console.error);
