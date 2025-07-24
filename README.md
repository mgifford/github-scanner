# GitHub Organization Accessibility Issue Scanner

This Node.js script allows you to scan all repositories within a specified GitHub organization for issues related to accessibility. It can identify issues by specific labels and/or by searching for the "accessibility" keyword in the issue title or body. The results are compiled into a CSV file, formatted for easy analysis.

## Features

* Scans all public repositories (and private if your PAT has access) within a given GitHub organization.
* Identifies issues marked with a primary "accessibility" label (default) or any other specified label(s).
* Also identifies issues where the keyword "accessibility" appears in the title or description.
* Attempts to extract WCAG Success Criteria (SC) references from issue titles, descriptions, and comments.
* Outputs data to a CSV file with a structured format, including issue details, repository name, reporter, and timestamps.
* Provides a command-line interface with options for specifying the organization, primary label, and additional labels.

## Prerequisites

Before you can run this script, you need to have:

1.  **Node.js and npm (Node Package Manager) installed:**
    * You can download Node.js from the official website: [nodejs.org](https://nodejs.org/). `npm` is included with Node.js.
    * Verify your installation by running:
        ```bash
        node -v
        npm -v
        ```

2.  **A GitHub Personal Access Token (PAT):**
    * This token is required to authenticate with the GitHub API and bypass strict rate limits. It is generated from your personal GitHub account, not directly from the organization.
    * **To generate a PAT:**
        1.  Log in to your GitHub account.
        2.  Go to your `Settings` (usually by clicking your profile picture in the top right).
        3.  In the left sidebar, navigate to `Developer settings` > `Personal access tokens` > `Tokens (classic)`.
        4.  Click `Generate new token (classic)`.
        5.  Give it a descriptive `Note` (e.g., "Accessibility Scanner").
        6.  Set an `Expiration` (for security, it's recommended not to set "No expiration").
        7.  **Crucially, select the `repo` scope (checkbox).** This grants the necessary permissions to read repository and issue data.
        8.  Click `Generate token` at the bottom.
        9.  **IMMEDIATELY COPY THE GENERATED TOKEN STRING.** You will not be able to see it again.

    * **To set the PAT as an environment variable (`GITHUB_TOKEN`):**
        * **Linux / macOS:**
            ```bash
            export GITHUB_TOKEN="YOUR_COPIED_PAT_HERE"
            ```
            (For persistent use, add this line to your `~/.bashrc`, `~/.zshrc`, or equivalent shell profile file).
        * **Windows (Command Prompt):**
            ```cmd
            set GITHUB_TOKEN="YOUR_COPIED_PAT_HERE"
            ```
        * **Windows (PowerShell):**
            ```powershell
            $env:GITHUB_TOKEN="YOUR_COPIED_PAT_HERE"
            ```
        *Replace `YOUR_COPIED_PAT_HERE` with the actual token string you copied.*

## Installation

1.  **Create a project directory** and navigate into it:
    ```bash
    mkdir github-accessibility-scanner
    cd github-accessibility-scanner
    ```

2.  **Initialize a Node.js project:**
    ```bash
    npm init -y
    ```

3.  **Install the necessary npm packages:**
    ```bash
    npm install @octokit/rest csv-stringify minimist
    ```

4.  **Create the script file:**
    * Create a file named `gather-accessibility-issues.js` in your project directory.
    * Paste the entire script code (provided in our previous conversation) into this file.

## Usage

Run the script from your terminal within the project directory.

### Basic Usage (Scans for 'accessibility' label and keyword)

To scan an organization (e.g., `localgovdrupal`) using the default primary label (`accessibility`) and also searching for the keyword "accessibility":

```bash
node gather-accessibility-issues.js -r localgovdrupal
````

or

```bash
node gather-accessibility-issues.js --repo localgovdrupal
```

### Specifying a Primary Label

To scan for issues tagged with a specific label (e.g., `atag`) instead of the default `accessibility` label:

```bash
node gather-accessibility-issues.js -r localgovdrupal -l atag
```

or

```bash
node gather-accessibility-issues.js --repo localgovdrupal --label atag
```

### Specifying Additional Labels

To include issues with other specific labels (e.g., `bug` and `enhancement`) in addition to the primary label:

```bash
node gather-accessibility-issues.js -r localgovdrupal -a "bug,enhancement"
```

or

```bash
node gather-accessibility-issues.js --repo localgovdrupal --additional-labels "bug,enhancement"
```

You can combine the primary and additional label options:

```bash
node gather-accessibility-issues.js -r localgovdrupal -l atag -a "design,docs"
```

### Help Message

To view the usage instructions and available options:

```bash
node gather-accessibility-issues.js -h
```

or

```bash
node gather-accessibility-issues.js --help
```

(Running `node gather-accessibility-issues.js` without any arguments will also display the help message and an error).

## Output

The script will generate a CSV file in the same directory where you run the script. The filename will follow the pattern: `[organization_name]-accessibility-issues-[YYYY-MM-DD].csv` (e.g., `localgovdrupal-accessibility-issues-2025-07-24.csv`).

The CSV file will contain the following columns:

  * **WCAG SC:** Semicolon-separated list of WCAG Success Criteria found in the issue text (best effort detection).
  * **Issue ID:** Unique identifier for the issue, formatted as `repository_name-issue_number` (e.g., `localgov_microsites-859`).
  * **Issue Title:** The title of the GitHub issue.
  * **Issue URL:** The direct URL to the issue on GitHub.
  * **Project:** The name of the GitHub repository.
  * **Status:** The current state of the issue (`open` or `closed`).
  * **Priority:** (Currently `null` as this is not a standard GitHub field).
  * **Component:** (Currently `null` as this is not a standard GitHub field).
  * **Version:** (Currently `null` as this is not a standard GitHub field).
  * **Reporter:** The GitHub username of the issue creator.
  * **Created:** Timestamp when the issue was created.
  * **Updated:** Timestamp when the issue was last updated.
  * **Comments:** Number of comments on the issue.
  * **Has Fork:** `Yes` if the repository is a fork, `No` otherwise.
  * **Last Commenter:** The GitHub username of the last person to comment on the issue.
  * **Extracted At:** Timestamp when the data was extracted by the script.
