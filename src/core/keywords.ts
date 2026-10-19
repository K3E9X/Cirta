/**
 * [P0-2] Hidden keyword stuffing: a pile of skills hidden from the reader for
 * the screening software that reads the file. It is the commonest trick in
 * the CVs that cheat — 90 to 96 % of those found in 196 682 real CVs
 * (arXiv 2605.28999) — and a different one from an order given to a model:
 * no verb, no sentence, terms one after another.
 *
 * Only hidden text is ever classified here. A visible skills section is the
 * same words and perfectly honest; what makes it stuffing is that nobody was
 * meant to see it.
 *
 * The rule, kept simple enough to explain to the recruiter it warns:
 *   - at least five terms;
 *   - at least four of them are skills, tools or technologies (from the
 *     list below, or shaped like one: C++, ISO 27001, Node.js);
 *   - those make up at least half of the text;
 *   - next to no grammar: no pronoun, and few function words.
 * A sentence full of technical words ("I moved the service to Kubernetes on
 * AWS") has a pronoun and articles, and is not one.
 */

/** Skills, tools and technologies, French and English, lower case; phrases of up to three words. */
const SKILLS = new Set([
  // Languages and runtimes
  'python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c', 'c++', 'c#', '.net', 'php', 'ruby', 'scala', 'kotlin', 'swift',
  'r', 'matlab', 'perl', 'bash', 'shell', 'powershell', 'sql', 'nosql', 'pl/sql', 't-sql', 'vba', 'cobol', 'fortran', 'haskell', 'elixir',
  'html', 'css', 'sass', 'node.js', 'nodejs', 'deno', 'dart', 'lua', 'groovy', 'objective-c', 'assembly', 'solidity',
  // Frameworks and libraries
  'react', 'react native', 'angular', 'vue', 'vue.js', 'next.js', 'nuxt', 'svelte', 'django', 'flask', 'fastapi', 'spring', 'spring boot',
  'rails', 'ruby on rails', 'laravel', 'symfony', 'express', 'nestjs', 'flutter', 'jquery', 'bootstrap', 'tailwind', 'graphql', 'redux',
  'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'pandas', 'numpy', 'spark', 'pyspark', 'hadoop', 'kafka', 'airflow', 'dbt', 'hibernate',
  // Data and storage
  'postgresql', 'postgres', 'mysql', 'mariadb', 'oracle', 'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'snowflake',
  'databricks', 'bigquery', 'redshift', 'sqlite', 'neo4j', 'etl', 'elt', 'data warehouse', 'data lake', 'data engineering', 'data science',
  'data analysis', 'data analytics', 'data visualization', 'big data', 'business intelligence', 'bi', 'power bi', 'tableau', 'looker', 'qlik',
  'excel', 'statistics', 'statistiques', 'analyse de données', 'science des données', 'machine learning', 'deep learning', 'ai', 'ia',
  'artificial intelligence', 'intelligence artificielle', 'apprentissage automatique', 'nlp', 'computer vision', 'llm', 'llms', 'genai',
  'generative ai', 'rag', 'mlops', 'prompt engineering',
  // Cloud, infrastructure, delivery
  'aws', 'azure', 'gcp', 'google cloud', 'cloud', 'docker', 'kubernetes', 'k8s', 'openshift', 'terraform', 'ansible', 'puppet', 'chef',
  'jenkins', 'gitlab', 'github', 'github actions', 'git', 'ci/cd', 'cicd', 'devops', 'devsecops', 'sre', 'linux', 'unix', 'windows server',
  'vmware', 'helm', 'argocd', 'prometheus', 'grafana', 'datadog', 'nginx', 'apache', 'microservices', 'serverless', 'rest', 'rest api',
  'api', 'apis', 'grpc', 'soap', 'kafka streams', 'rabbitmq', 'tcp/ip', 'networking', 'réseaux', 'cisco', 'ccna', 'ccnp',
  // Security
  'cybersecurity', 'cybersécurité', 'security', 'sécurité', 'infosec', 'iso 27001', 'iso27001', 'iso 27002', 'soc', 'siem', 'soar', 'edr',
  'xdr', 'pentest', 'pentesting', 'penetration testing', "tests d'intrusion", 'red team', 'blue team', 'threat hunting', 'incident response',
  'forensics', 'nist', 'gdpr', 'rgpd', 'ebios', 'anssi', 'nis2', 'dora', 'pci dss', 'splunk', 'firewall', 'pare-feu', 'iam', 'pki', 'owasp',
  'cissp', 'cism', 'cisa', 'ceh', 'oscp', 'comptia', 'zero trust', 'vulnerability management', 'gestion des vulnérabilités',
  // Methods and certifications
  'agile', 'scrum', 'kanban', 'safe', 'lean', 'six sigma', 'prince2', 'pmp', 'itil', 'togaf', 'cobit', 'jira', 'confluence', 'trello',
  'asana', 'notion', 'ms project', 'project management', 'gestion de projet', 'chef de projet', 'product management', 'product owner',
  'scrum master', 'program management', 'change management', 'conduite du changement', 'risk management', 'gestion des risques',
  'stakeholder management', 'design thinking', 'ux', 'ui', 'ux design', 'ui design', 'figma', 'sketch', 'adobe xd', 'photoshop',
  'illustrator', 'indesign', 'premiere pro', 'after effects', 'autocad', 'solidworks', 'catia', 'revit', 'sap', 'sap s/4hana', 'erp',
  'crm', 'salesforce', 'hubspot', 'zoho', 'servicenow', 'sharepoint', 'office 365', 'microsoft office', 'word', 'powerpoint', 'outlook',
  'google workspace',
  // Business functions
  'management', 'leadership', 'communication', 'negotiation', 'négociation', 'sales', 'vente', 'ventes', 'business development',
  'développement commercial', 'account management', 'key account management', 'customer success', 'relation client', 'service client',
  'marketing', 'marketing digital', 'digital marketing', 'seo', 'sea', 'sem', 'smo', 'growth hacking', 'content marketing',
  'social media', 'réseaux sociaux', 'brand management', 'e-commerce', 'ecommerce', 'b2b', 'b2c', 'saas', 'recruitment', 'recrutement',
  'talent acquisition', 'sourcing', 'hr', 'rh', 'ressources humaines', 'human resources', 'payroll', 'paie', 'onboarding',
  'accounting', 'comptabilité', 'audit', 'ifrs', 'gaap', 'finance', 'financial analysis', 'analyse financière', 'budgeting', 'budget',
  'forecasting', 'contrôle de gestion', 'fiscalité', 'tax', 'treasury', 'trésorerie', 'consolidation', 'compliance', 'conformité',
  'supply chain', 'logistics', 'logistique', 'procurement', 'achats', 'operations', 'kpi', 'okr', 'reporting', 'strategy', 'stratégie',
  'consulting', 'conseil', 'legal', 'juridique', 'contract management',
  // Qualities, as they are piled up
  'teamwork', 'team player', 'travail en équipe', "esprit d'équipe", 'problem solving', 'résolution de problèmes', 'critical thinking',
  'autonomie', 'autonomous', 'rigueur', 'organisation', 'adaptabilité', 'adaptability', 'creativity', 'créativité', 'motivated',
  'motivé', 'dynamique', 'proactive', 'proactif', 'detail-oriented', 'time management', 'gestion du temps', 'bilingual', 'bilingue',
  'anglais courant', 'fluent english', 'english', 'anglais', 'french', 'français', 'german', 'allemand', 'spanish', 'espagnol',
  'mba', 'phd', 'master', 'bachelor', 'ingénieur', 'engineer', 'senior', 'expert', 'architect', 'architecte', 'full stack', 'fullstack',
  'backend', 'back-end', 'frontend', 'front-end', 'mobile', 'ios', 'android', 'embedded', 'embarqué', 'iot', 'blockchain', 'web3',
]);

/** Words that make a sentence: pronouns first — any one of them and it is prose, not a pile. */
const PRONOUNS = new Set([
  'i', "i'm", "i've", 'me', 'my', 'we', 'our', 'us', 'you', 'your', 'he', 'she', 'they', 'it', 'its', 'their',
  'je', "j'ai", "j'", 'me', 'moi', 'mon', 'ma', 'mes', 'nous', 'notre', 'nos', 'vous', 'votre', 'vos', 'il', 'elle', 'ils', 'elles', 'leur', 'leurs', 'tu', 'ton', 'ta', 'tes',
]);

const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'this', 'that', 'these', 'those', 'there', 'here', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'not', 'no', 'but',
  'le', 'la', 'les', "l'", 'un', 'une', 'des', 'du', 'de', "d'", 'et', 'ou', 'en', 'au', 'aux', 'pour', 'par', 'avec', 'sur', 'dans',
  'est', 'sont', 'été', 'être', 'avoir', 'a', 'ont', 'ce', 'cette', 'ces', 'qui', 'que', 'dont', 'ne', 'pas', 'plus', 'très', 'mais',
]);

const MIN_TERMS = 5;
const MIN_SKILLS = 4;
const MAX_PHRASE = 3;

/** A term shaped like a technology even when it is not in the list: C++, ISO 27001's number, Node.js, S3, CI/CD. */
// A bare number is not one: a run of years would read as a pile of skills.
const TECH_SHAPED = /^(?=.*[a-z])(?:[a-z0-9]+[.+#/-][a-z0-9.+#/-]*|[a-z]+\d+[a-z0-9]*|\.[a-z]+)$/;

function terms(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .split(/[\s,;|•·▪◦●■►→()[\]{}"«»]+/u)
    .map((term) => term.replace(/^[.:!?]+(?!net\b)|[.:!?]+$/g, ''))
    .filter(Boolean);
}

export function keywordStuffing(text: string): boolean {
  const list = terms(text);
  if (list.length < MIN_TERMS) return false;
  let skills = 0;
  let covered = 0;
  let grammar = 0;
  for (let i = 0; i < list.length; ) {
    let matched = 0;
    for (let n = Math.min(MAX_PHRASE, list.length - i); n >= 1; n--) {
      if (SKILLS.has(list.slice(i, i + n).join(' '))) {
        matched = n;
        break;
      }
    }
    const term = list[i]!;
    if (!matched && TECH_SHAPED.test(term)) matched = 1;
    if (matched) {
      skills++;
      covered += matched;
      i += matched;
      continue;
    }
    // "j'ai" and "l'ERP": the elided article or pronoun is the grammar.
    const head = /^([a-z]+')/.exec(term)?.[1];
    if (PRONOUNS.has(term) || (head && PRONOUNS.has(head))) return false;
    if (FUNCTION_WORDS.has(term) || (head && FUNCTION_WORDS.has(head))) grammar++;
    i++;
  }
  return skills >= MIN_SKILLS && covered * 2 >= list.length && grammar * 5 <= list.length;
}

/** The finding's label: hidden text that is a pile of keywords, for the software that screens CVs. */
export const STUFFING_LABEL = 'Hidden keyword stuffing';
