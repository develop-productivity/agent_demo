---
name: search
description: Search related skills
version: 1.0
category: information-retrieval
---

# Search Skill

This skill handles **search-related queries** and provides capabilities for locating, retrieving, and summarizing information from the web.

## Core Capabilities

- **Web Search**: Perform general-purpose web searches using keywords to find relevant pages and resources.
- **Semantic Search**: Understand the meaning and intent behind queries to return more contextually relevant results.
- **Result Retrieval**: Access and extract content from search result pages for further processing.
- **Information Summarization**: Synthesize information from multiple sources into structured, concise answers.
- **Filtering**: Narrow down results by date range, domain, content type, or other criteria.

## Usage

The search skill can be invoked for tasks such as:

1. Finding the latest news on a specific topic
2. Researching a subject and compiling a summary
3. Looking up factual information (dates, definitions, statistics)
4. Locating resources (documents, tools, websites) relevant to a query
5. Comparing information from multiple sources

## Output Format

Results are returned in a structured format with:

- **Title** – The title of the result or page
- **Source** – The URL or origin of the information
- **Snippet** – A brief excerpt or summary of the content
- **Relevance Score** – (where applicable) An indicator of how well the result matches the query
- **Timestamp** – The date when the information was published or last updated

## Notes

- The search skill supports both **keyword-based lookup** and **natural language queries**.
- Results can be filtered by **date**, **domain**, or **content type** for greater precision.
- For privacy-sensitive queries, consider using anonymized search endpoints.
