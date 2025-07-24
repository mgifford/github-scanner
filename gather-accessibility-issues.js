// gather-accessibility-issues.js

const { Octokit } = require('@octokit/rest');
const { stringify } = require('csv-stringify');
const fs = require('fs');
const minimist = require('minimist');

// --- Configuration ---
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Get token from environment variable
const ACCESSIBILITY_LABEL = 'accessibility';
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
        while ((match = pattern.exec(text)) !== null) {
            // Adjust based on specific pattern groups if needed
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
            if (response.data.length > 0) {
                allItems = allItems.concat(response.data);
                page++;
            } else {
                hasMore = false;
            }
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            // Implement more robust error handling / retry logic if needed
            hasMore = false; // Stop on error
        }
    }
    return allItems;
}

// --- Main Script Logic ---

async function gatherAccessibilityIssues(orgName) {
    console.log(`Scanning GitHub organization: ${orgName}`);
    const issuesData = [];
    const processedIssueIds = new Set(); // To prevent duplicate issues from different search methods

    // CSV Headers
    const csvHeaders = [
        "WCAG SC", "Issue ID", "Issue Title", "Issue URL", "Project",
        "Status", "Priority", "Component", "Version", "Reporter",
        "Created", "Updated", "Comments", "Has Fork", "Last Commenter", "Extracted At"
    ];

    // 1. Get all repositories for the organization
    console.log('Fetching repositories...');
    const repositories = await fetchAllPages(octokit.repos.listForOrg, { org: orgName, type: 'public' });
    console.log(`Found ${repositories.length} repositories.`);

    for (const repo of repositories) {
        console.log(`Processing repository: ${repo.full_name}`);

        // Get issues for this repository
        const repoIssues = await fetchAllPages(octokit.issues.listForRepo, {
            owner: repo.owner.login,
            repo: repo.name,
            state: 'all' // Get both open and closed issues
        });

        for (const issue of repoIssues) {
            // Skip pull requests (issues API returns PRs too)
            if (issue.pull_request) {
                continue;
            }

            if (processedIssueIds.has(issue.id)) {
                continue;
            }
            processedIssueIds.add(issue.id);

            const isLabelledAccessibility = issue.labels.some(label => label.name.toLowerCase() === ACCESSIBILITY_LABEL);
            const isKeywordFound = issue.title.toLowerCase().includes('accessibility') || (issue.body && issue.body.toLowerCase().includes('accessibility'));

            if (!isLabelledAccessibility && !isKeywordFound) {
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
                        lastCommenter = comments[comments.length - 1].user.login;
                        comments.forEach(comment => {
                            wcagScFound = wcagScFound.concat(findWcagScInText(comment.body));
                        });
                    }
                } catch (commentError) {
                    console.warn(`Warning: Could not fetch comments for issue ${issue.html_url}: ${commentError.message}`);
                }
            }

            // Also check issue body for WCAG SC
            wcagScFound = wcagScFound.concat(findWcagScInText(issue.body));
            wcagScFound = [...new Set(wcagScFound)]; // Deduplicate WCAG SC found

            issuesData.push({
                "WCAG SC": wcagScFound.join('; '),
                // MODIFICATION HERE: Combine repo.name and issue.number for unique ID
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

    console.log(`Found ${issuesData.length} accessibility-related issues.`);

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

// --- Command Line Argument Parsing ---
const argv = minimist(process.argv.slice(2));

if (!argv.r && !argv.repo) {
    console.log('Usage: node gather-accessibility-issues.js -r <github_organization_name>');
    console.log('Or: node gather-accessibility-issues.js --repo <github_organization_name>');
    process.exit(0);
}

const organization = argv.r || argv.repo;
gatherAccessibilityIssues(organization).catch(console.error);
