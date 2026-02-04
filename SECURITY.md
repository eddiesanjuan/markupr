# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public issue
2. Email the maintainer directly or use GitHub's private vulnerability reporting
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Initial response**: Within 48 hours
- **Status update**: Within 1 week
- **Resolution**: Depends on severity

## Security Considerations

FeedbackFlow is designed with privacy in mind:

- **Local transcription**: Audio is processed locally using Whisper.cpp
- **No cloud uploads**: Your recordings never leave your device
- **No telemetry**: We don't collect usage data
- **Open source**: All code is auditable

## Scope

The following are in scope for security reports:

- Code vulnerabilities in the Electron app
- Privacy issues with audio/data handling
- Issues with the build/release process

The following are out of scope:

- Vulnerabilities in third-party dependencies (report to upstream)
- Social engineering
- Physical access attacks
