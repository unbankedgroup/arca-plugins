# Arca Plugins

Official plugin marketplace for Arca -- AI ops platform for SMBs.

## Plugins

### arca (v2.0.0)
Skills and workflows for running AI agent operations.

**Skills included:**
- `kb-query` - Search knowledge base before answering factual questions
- `kb-ingest` - Ingest source documents into the knowledge base
- `kb-lint` - Health check the knowledge base vault
- `company-research` - Deep company research and ICP scoring
- `content-strategy` - Content planning with SEO topic clusters

## Installation

Add this marketplace to your Claude Code settings:

```json
{
  "extraKnownMarketplaces": {
    "arca-plugins": {
      "source": {
        "source": "git",
        "url": "https://github.com/unbankedgroup/arca-plugins.git"
      }
    }
  }
}
```

Then enable the plugin:

```json
{
  "enabledPlugins": {
    "arca@arca-plugins": true
  }
}
```
