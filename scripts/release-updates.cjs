/* Reviewed, deployment-only release notes. No network or production side effects. */
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const categories = ['added', 'improved', 'fixed'];
const git = (...args) => execFileSync('git', args, {cwd:ROOT, encoding:'utf8'}).trim();
const resolveCommit = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
const text = value => typeof value === 'string' && value.trim().length > 0;

function prepare(options) {
    let hashes;
    if (options.commits) {
        if (options.from || options.to) throw Error('Use --commits OR --from/--to');
        hashes = options.commits.split(',').map(resolveCommit);
    } else {
        if (!options.from || !options.to) throw Error('Provide --from and --to, or --commits');
        const from = resolveCommit(options.from), to = resolveCommit(options.to);
        execFileSync('git', ['merge-base', '--is-ancestor', from, to], {cwd:ROOT});
        hashes = git('rev-list', '--reverse', `${from}..${to}`).split('\n').filter(Boolean);
    }
    if (!hashes.length || new Set(hashes).size !== hashes.length) throw Error('Expected a nonempty, unique commit list');
    return {
        title:'', summary:'',
        commits:hashes.map(hash => ({
            hash, subject:git('show', '-s', '--format=%s', hash),
            paths:git('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', hash).split('\n').filter(Boolean),
            category:'improved', summary:''
        }))
    };
}

function record(notes, deployedAt, existing) {
    if (!text(deployedAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(deployedAt) || !Number.isFinite(Date.parse(deployedAt))) {
        throw Error('--deployed-at must be an ISO timestamp with a timezone');
    }
    if (!text(notes.title) || !text(notes.summary) || !Array.isArray(notes.commits) || !notes.commits.length) throw Error('Complete the reviewed title, summary and commits');
    if (!Array.isArray(existing) || existing.some(item => !item || !text(item.id))) throw Error('Invalid existing history');
    const hashes = new Set();
    const commits = notes.commits.map(commit => {
        if (!commit || !/^[a-f0-9]{40}$/.test(commit.hash) || hashes.has(commit.hash) || !text(commit.summary) || !categories.includes(commit.category)) throw Error('Each commit needs a unique full hash, reviewed summary and category');
        if (resolveCommit(commit.hash) !== commit.hash) throw Error('Unknown commit');
        hashes.add(commit.hash);
        return {hash:commit.hash, category:commit.category, summary:commit.summary.trim()};
    });
    const timestamp = new Date(deployedAt).toISOString();
    const id = `deploy-${timestamp.replace(/[-:.]/g, '')}`;
    const date = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date(timestamp));
    const release = {id, date, deployedAt:timestamp, title:notes.title.trim(), summary:notes.summary.trim(),
        added:[], improved:[], fixed:[], commits};
    for (const commit of commits) release[commit.category].push(commit.summary);
    const previous = existing.find(item => item.id === id);
    if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(release)) throw Error('Release ID already exists with different content');
        return existing;
    }
    return [release, ...existing];
}

function main(argv) {
    const [command, ...args] = argv, options = {};
    const allowed = command === 'prepare' ? ['from','to','commits','output'] : command === 'record' ? ['notes','deployed-at'] : [];
    if (!allowed.length) throw Error('Usage: release-updates.cjs prepare --from <ref> --to <ref> --output <draft.json> | record --notes <reviewed.json> --deployed-at <ISO timestamp>');
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace(/^--/, '');
        if (!args[i].startsWith('--') || !allowed.includes(key) || !args[i+1] || options[key]) throw Error('Invalid or duplicate option: ' + args[i]);
        options[key] = args[i+1];
    }
    if (command === 'prepare') {
        const content = JSON.stringify(prepare(options), null, 2) + '\n';
        if (options.output) fs.writeFileSync(options.output, content, {flag:'wx'});
        else process.stdout.write(content);
    } else {
        if (!options.notes) throw Error('Provide --notes');
        const feedPath = path.join(ROOT, 'data/system-updates.json');
        const content = record(JSON.parse(fs.readFileSync(options.notes, 'utf8')), options['deployed-at'], JSON.parse(fs.readFileSync(feedPath, 'utf8')));
        const temporary = feedPath + '.tmp-' + process.pid;
        try {
            fs.writeFileSync(temporary, JSON.stringify(content, null, 2) + '\n', {flag:'wx'});
            fs.renameSync(temporary, feedPath);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        console.log('Recorded deployment history: ' + content[0].id);
    }
}
if (require.main === module) {
    try { main(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {prepare, record};
