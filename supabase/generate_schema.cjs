const fs = require('fs');
const path = require('path');

const columnsPath = '/tmp/columns.json';
const constraintsPath = '/tmp/constraints.json';
const enumsPath = '/tmp/enums.json';

function loadJson(p) {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch(e) {
        console.error('Error parsing', p, e.message);
        return [];
    }
}

const columns = loadJson(columnsPath);
const constraints = loadJson(constraintsPath);
const enums = loadJson(enumsPath);

if (columns.length === 0 || constraints.length === 0 || enums.length === 0) {
    console.error('Failed to load some metadata. Columns:', columns.length, 'Constraints:', constraints.length, 'Enums:', enums.length);
    process.exit(1);
}

let sql = `-- Generated IbizaBeyond Full Schema
-- Created at ${new Date().toISOString()}

-- Extensions
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Set search path
SET search_path TO public, extensions, auth;

-- Schemas
CREATE SCHEMA IF NOT EXISTS auth;

-- Custom types (Enums)
`;

// Unique enums
const uniqueEnums = {};
enums.forEach(e => {
    if (!uniqueEnums[e.name]) uniqueEnums[e.name] = [];
    uniqueEnums[e.name].push(e.value);
});

for (const name in uniqueEnums) {
    sql += `DO $$ BEGIN CREATE TYPE public.${name} AS ENUM (${uniqueEnums[name].map(v => `'${v}'`).join(', ')}); EXCEPTION WHEN duplicate_object THEN null; END $$;\n`;
}

sql += '\n-- Tables\n';

// Group columns by schema and table
const tableMap = {};
columns.forEach(c => {
    const key = `${c.table_schema}.${c.table_name}`;
    if (!tableMap[key]) tableMap[key] = [];
    tableMap[key].push(c);
});

// Primary keys mapping
const pkMap = {};
constraints.filter(con => con.constraint_type === 'PRIMARY KEY').forEach(con => {
    const key = `${con.table_schema}.${con.table_name}`;
    if (!pkMap[key]) pkMap[key] = [];
    pkMap[key].push(con.column_name);
});

for (const tableKey in tableMap) {
    const [schema, name] = tableKey.split('.');
    if (name.startsWith('vw_')) continue;

    if (schema === 'public' || name === 'users') { 
        sql += `CREATE TABLE IF NOT EXISTS ${schema}.${name} (\n`;
        const colDefs = tableMap[tableKey].map(c => {
            let type = c.data_type;
            if (type === 'USER-DEFINED') {
                if (c.column_default && (c.column_default.includes('::') || c.column_default.includes('public.'))) {
                    const parts = c.column_default.split('::')[1] || c.column_default.split('public.')[1];
                    type = 'public.' + parts.trim();
                } else {
                    if (c.column_name.includes('status')) type = 'public.quote_status';
                    else if (c.column_name.includes('type')) type = 'public.boat_type';
                    else type = 'text';
                }
            }
            
            let def = `    ${c.column_name} ${type}`;

            if (c.is_nullable === 'NO') def += ' NOT NULL';
            if (c.column_default && !c.column_default.includes('nextval')) {
                def += ` DEFAULT ${c.column_default}`;
            }
            return def;
        });

        if (pkMap[tableKey]) {
            colDefs.push(`    CONSTRAINT ${name}_pkey PRIMARY KEY (${pkMap[tableKey].join(', ')})`);
        }

        sql += colDefs.join(',\n');
        sql += '\n);\n\n';
    }
}

sql += '\n-- Foreign Key Constraints\n';
constraints.filter(con => con.constraint_type === 'FOREIGN KEY').forEach(con => {
    if (tableMap[`${con.table_schema}.${con.table_name}`] && tableMap[`${con.foreign_table_schema}.${con.foreign_table_name}`]) {
        sql += `ALTER TABLE ONLY ${con.table_schema}.${con.table_name}
    ADD CONSTRAINT fk_${con.table_name}_${con.column_name}
    FOREIGN KEY (${con.column_name}) REFERENCES ${con.foreign_table_schema}.${con.foreign_table_name}(${con.foreign_column_name}) ON DELETE SET NULL;\n`;
    }
});

fs.writeFileSync('/root/ibizabeyond/supabase/full_schema.sql', sql);
console.log('Successfully generated full_schema.sql');
