// lib/ontology.js — Normalizes concepts across stacks into universal ontology
// Zero IA calls. Pure mapping tables.

const ONTOLOGY_MAP = {
  // Ingress layer
  "controller": { layer: "ingress", normalized: "Controller" },
  "route": { layer: "ingress", normalized: "Route Handler" },
  "router": { layer: "ingress", normalized: "Router" },
  "resolver": { layer: "ingress", normalized: "GraphQL Resolver" },
  "handler": { layer: "ingress", normalized: "Request Handler" },
  "endpoint": { layer: "ingress", normalized: "API Endpoint" },
  "lambda": { layer: "ingress", normalized: "Serverless Function" },
  "gateway": { layer: "ingress", normalized: "API Gateway" },
  "middleware": { layer: "ingress", normalized: "Middleware" },
  "interceptor": { layer: "ingress", normalized: "Interceptor" },
  "filter": { layer: "ingress", normalized: "Filter" },
  "servlet": { layer: "ingress", normalized: "Servlet" },
  "resource": { layer: "ingress", normalized: "REST Resource" },
  "controller.ts": { layer: "ingress", normalized: "Controller" },
  "controller.js": { layer: "ingress", normalized: "Controller" },
  "route.ts": { layer: "ingress", normalized: "Route Handler" },
  "route.js": { layer: "ingress", normalized: "Route Handler" },

  // Logic Core — Business
  "service": { layer: "logic-core", normalized: "Service", sublayer: "business" },
  "usecase": { layer: "logic-core", normalized: "Use Case", sublayer: "business" },
  "use_case": { layer: "logic-core", normalized: "Use Case", sublayer: "business" },
  "domain": { layer: "logic-core", normalized: "Domain Entity", sublayer: "business" },
  "business": { layer: "logic-core", normalized: "Business Logic", sublayer: "business" },
  "logic": { layer: "logic-core", normalized: "Business Logic", sublayer: "business" },
  "application": { layer: "logic-core", normalized: "Application Service", sublayer: "business" },
  "interactor": { layer: "logic-core", normalized: "Interactor", sublayer: "business" },
  "command": { layer: "logic-core", normalized: "Command Handler", sublayer: "business" },
  "query": { layer: "logic-core", normalized: "Query Handler", sublayer: "business" },
  "processor": { layer: "logic-core", normalized: "Processor", sublayer: "business" },
  "orchestrator": { layer: "logic-core", normalized: "Orchestrator", sublayer: "business" },

  // Logic Core — Data Access
  "repository": { layer: "logic-core", normalized: "Repository", sublayer: "data-access" },
  "dao": { layer: "logic-core", normalized: "Data Access Object", sublayer: "data-access" },
  "mapper": { layer: "logic-core", normalized: "Data Mapper", sublayer: "data-access" },
  "adapter": { layer: "logic-core", normalized: "Adapter", sublayer: "data-access" },
  "prisma client": { layer: "logic-core", normalized: "Prisma Client", sublayer: "data-access" },
  "eloquent": { layer: "logic-core", normalized: "Eloquent ORM", sublayer: "data-access" },

  // Logic Core — Patterns
  "factory": { layer: "logic-core", normalized: "Factory", sublayer: "pattern" },
  "builder": { layer: "logic-core", normalized: "Builder", sublayer: "pattern" },
  "strategy": { layer: "logic-core", normalized: "Strategy", sublayer: "pattern" },
  "validator": { layer: "logic-core", normalized: "Validator", sublayer: "pattern" },

  // State Store
  "model": { layer: "state-store", normalized: "Data Model" },
  "entity": { layer: "state-store", normalized: "Entity" },
  "schema": { layer: "state-store", normalized: "Schema" },
  "migration": { layer: "state-store", normalized: "Migration" },
  "table": { layer: "state-store", normalized: "Database Table" },
  "database": { layer: "state-store", normalized: "Database" },
  "db": { layer: "state-store", normalized: "Database Connection" },
  "cache": { layer: "state-store", normalized: "Cache Layer" },
  "redis": { layer: "state-store", normalized: "Redis Cache" },
  "queue": { layer: "state-store", normalized: "Message Queue" },
  "kafka": { layer: "state-store", normalized: "Kafka Topic" },
  "rabbitmq": { layer: "state-store", normalized: "RabbitMQ Queue" },
  "s3": { layer: "state-store", normalized: "S3 Storage" },
  "storage": { layer: "state-store", normalized: "Storage" },
  "bucket": { layer: "state-store", normalized: "Storage Bucket" },
  "dynamo": { layer: "state-store", normalized: "DynamoDB Table" },
  "mongo": { layer: "state-store", normalized: "MongoDB Collection" },
  "supabase": { layer: "state-store", normalized: "Supabase Table" },
};

const STACK_SYNONYMS = {
  // ORMs
  "prisma": "ORM (Prisma)",
  "typeorm": "ORM (TypeORM)",
  "sequelize": "ORM (Sequelize)",
  "django.orm": "ORM (Django ORM)",
  "sqlalchemy": "ORM (SQLAlchemy)",
  "gorm": "ORM (GORM)",
  "jpa": "ORM (JPA/Hibernate)",
  "eloquent": "ORM (Eloquent)",
  // Frameworks
  "express": "Web Framework (Express)",
  "fastify": "Web Framework (Fastify)",
  "koa": "Web Framework (Koa)",
  "nestjs": "Web Framework (NestJS)",
  "fastapi": "Web Framework (FastAPI)",
  "django": "Web Framework (Django)",
  "flask": "Web Framework (Flask)",
  "spring": "Web Framework (Spring)",
  "gin": "Web Framework (Gin)",
  "fiber": "Web Framework (Fiber)",
  "actix": "Web Framework (Actix)",
  // Frontend
  "react": "Frontend Framework (React)",
  "vue": "Frontend Framework (Vue)",
  "angular": "Frontend Framework (Angular)",
  "svelte": "Frontend Framework (Svelte)",
  "next": "Meta-Framework (Next.js)",
  "nuxt": "Meta-Framework (Nuxt)",
  "remix": "Meta-Framework (Remix)",
};

export function normalizeConcept(term) {
  const lower = term.toLowerCase().trim();

  if (ONTOLOGY_MAP[lower]) {
    return ONTOLOGY_MAP[lower];
  }

  for (const [key, value] of Object.entries(ONTOLOGY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return value;
    }
  }

  return { layer: "unclassified", normalized: term };
}

export function normalizeStackName(name) {
  const lower = name.toLowerCase().trim();

  if (STACK_SYNONYMS[lower]) {
    return STACK_SYNONYMS[lower];
  }

  for (const [key, value] of Object.entries(STACK_SYNONYMS)) {
    if (lower.includes(key)) {
      return value;
    }
  }

  return name;
}

export function getLayerForFile(filePath, fileName) {
  const base = (fileName || filePath).toLowerCase();

  for (const [key, value] of Object.entries(ONTOLOGY_MAP)) {
    if (base === key || base.startsWith(key + ".") || base.includes(key)) {
      return value;
    }
  }

  return { layer: "unclassified", normalized: fileName || filePath };
}

export function getAllLayers() {
  return ["ingress", "logic-core", "state-store", "unclassified"];
}

export function getSublayers() {
  return {
    "logic-core": ["business", "data-access", "pattern"],
    "ingress": ["http", "graphql", "grpc", "middleware"],
    "state-store": ["database", "cache", "queue", "storage"],
  };
}
