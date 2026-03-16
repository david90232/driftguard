const SHELL_PATTERNS = [
  {
    id: "shell.curl_pipe",
    severity: "critical",
    description: "Pipe curl output into shell",
    regex: /curl\s+[^\n]*\|\s*(sh|bash)\b/i
  },
  {
    id: "shell.wget_pipe",
    severity: "critical",
    description: "Pipe wget output into shell",
    regex: /wget\s+[^\n]*\|\s*(sh|bash)\b/i
  },
  {
    id: "shell.eval",
    severity: "high",
    description: "Dynamic eval execution",
    regex: /\beval\s*\(/i
  },
  {
    id: "shell.exec_node",
    severity: "high",
    description: "Node child_process execution",
    regex: /child_process\s*\.\s*(exec|execSync|spawn|spawnSync)\s*\(/i
  },
  {
    id: "shell.exec_generic",
    severity: "low",
    confidence: "low",
    scored: false,
    description: "Generic exec call (low confidence)",
    regex: /\bexec\s*\(/i
  },
  {
    id: "shell.os_system",
    severity: "high",
    description: "os.system call",
    regex: /\bos\.system\s*\(/i
  },
  {
    id: "shell.subprocess",
    severity: "high",
    description: "Python subprocess usage",
    regex: /\bsubprocess\.(Popen|call|run|check_output)\s*\(/i
  },
  {
    id: "shell.shell_true",
    severity: "high",
    description: "Python subprocess shell=True",
    regex: /shell\s*=\s*True/
  },
  {
    id: "shell.runtime_exec",
    severity: "high",
    description: "Java Runtime exec",
    regex: /Runtime\.getRuntime\s*\(\)\.exec\s*\(/i
  },
  {
    id: "shell.process_builder",
    severity: "medium",
    description: "Java ProcessBuilder usage",
    regex: /new\s+ProcessBuilder\s*\(/i
  },
  {
    id: "shell.sh_c",
    severity: "medium",
    description: "Shell command with -c",
    regex: /\b(sh|bash)\s+-c\b/i
  }
];

const NETWORK_PATTERNS = [
  {
    id: "net.fetch",
    severity: "medium",
    description: "JavaScript fetch call",
    regex: /\bfetch\s*\(/i
  },
  {
    id: "net.axios",
    severity: "medium",
    description: "Axios HTTP client usage",
    regex: /\baxios\s*\./i
  },
  {
    id: "net.requests",
    severity: "medium",
    description: "Python requests usage",
    regex: /\brequests\.(get|post|put|delete|patch)\s*\(/i
  },
  {
    id: "net.curl",
    severity: "medium",
    description: "curl invocation",
    regex: /\bcurl\s+https?:\/\//i
  },
  {
    id: "net.wget",
    severity: "medium",
    description: "wget invocation",
    regex: /\bwget\s+https?:\/\//i
  },
  {
    id: "net.webhook",
    severity: "medium",
    description: "Webhook mention",
    regex: /\bwebhook\b/i
  },
  {
    id: "net.http_module",
    severity: "medium",
    description: "Node http/https request",
    regex: /\bhttps?\.request\s*\(/i
  }
];

const SENSITIVE_PATH_PATTERNS = [
  {
    id: "sensitive.env",
    severity: "high",
    description: "Reference to .env file",
    regex: /\.env\b/i
  },
  {
    id: "sensitive.ssh_key",
    severity: "critical",
    description: "Reference to SSH key",
    regex: /(id_rsa|id_ed25519|\.ssh\b)/i
  },
  {
    id: "sensitive.openclaw",
    severity: "low",
    description: "OpenClaw config reference",
    regex: /openclaw\.(json|toml|yaml|yml)/i
  },
  {
    id: "sensitive.driftguard",
    severity: "low",
    description: "Driftguard config reference",
    regex: /\.driftguard\.json\b/i
  },
  {
    id: "sensitive.soul",
    severity: "low",
    description: "Reference to SOUL.md",
    regex: /SOUL\.md/i
  },
  {
    id: "sensitive.memory",
    severity: "low",
    description: "Reference to MEMORY.md",
    regex: /MEMORY\.md/i
  }
];

const PROMPT_INJECTION_PATTERNS = [
  {
    id: "prompt.ignore_previous",
    severity: "high",
    description: "Prompt injection: ignore previous instructions",
    regex: /(ignore|disregard|forget)\s+(all\s+)?(previous|prior)\s+instructions/i
  },
  {
    id: "prompt.override_system",
    severity: "high",
    description: "Prompt injection: override system/developer",
    regex: /(override|bypass|jailbreak)\s+(system|developer|safety)/i
  },
  {
    id: "prompt.roleplay",
    severity: "medium",
    description: "Prompt injection: roleplay/system prompt mention",
    regex: /(system prompt|developer message|you are chatgpt|act as)/i
  },
  {
    id: "prompt.tools",
    severity: "medium",
    description: "Prompt injection: tool execution coercion",
    regex: /(execute|run)\s+(this|the)\s+(command|script|tool)/i
  }
];

const OBFUSCATION_PATTERNS = [
  {
    id: "obfuscation.base64",
    severity: "medium",
    description: "Base64 encode/decode usage",
    regex: /\b(base64|b64decode|atob|btoa)\b/i
  },
  {
    id: "obfuscation.long_base64",
    severity: "medium",
    description: "Suspicious long base64-like string",
    regex: /[A-Za-z0-9+\/]{200,}={0,2}/
  },
  {
    id: "obfuscation.long_hex",
    severity: "medium",
    description: "Suspicious long hex string",
    regex: /\b[0-9a-fA-F]{80,}\b/
  }
];

module.exports = {
  SHELL_PATTERNS,
  NETWORK_PATTERNS,
  SENSITIVE_PATH_PATTERNS,
  PROMPT_INJECTION_PATTERNS,
  OBFUSCATION_PATTERNS
};
