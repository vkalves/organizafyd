#!/usr/bin/env python3
"""Copy a reviewed Supabase storage manifest without deleting source files.
Requires an authorized, expiring migration token in a private --config JSON file.
No production records or queues are changed. Object bodies stream to temporary files.
"""
import argparse, base64, concurrent.futures, hashlib, json, os, pathlib, subprocess, tempfile, urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', required=True)
parser.add_argument('--config', required=True)
parser.add_argument('--profile', default='aws-project')
parser.add_argument('--execute', action='store_true', help='Without this flag only validate and count the manifest')
args = parser.parse_args()
config = json.loads(pathlib.Path(args.config).read_text())
manifest = json.loads(pathlib.Path(args.manifest).read_text())
allowed = {'media', 'instagram-publisher', 'x-media', 'tiktok-media'}
for item in manifest:
    if item['bucket_id'] not in allowed or any(x in ('', '.', '..') for x in item['name'].split('/')):
        raise SystemExit('Invalid manifest path')
print(json.dumps({'objects': len(manifest), 'bytes': sum(int(x['size']) for x in manifest), 'execute': args.execute}))
if not args.execute:
    raise SystemExit(0)
aws = os.environ.get('AWS_CLI', 'aws')
endpoint = 'https://csaplfphtvufxjhbpstl.supabase.co/functions/v1/s3-storage'
def cli(*values):
    result = subprocess.run([aws, *values, '--profile', args.profile, '--region', 'us-east-2', '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('AWS operation failed')
    return json.loads(result.stdout or '{}')
def copy(item):
    key = item['bucket_id'] + '/' + item['name']
    request = urllib.request.Request(endpoint, data=json.dumps({'action': 'migrate', 'bucket': item['bucket_id'], 'path': item['name']}).encode(), headers={'Content-Type': 'application/json', 'x-migration-token': config['migrationToken']})
    with urllib.request.urlopen(request, timeout=60) as response:
        source = json.load(response)
    # Re-runs must not overwrite new uploads or object versions.
    if source['exists']:
        head = cli('s3api', 'head-object', '--bucket', config['bucket'], '--key', key, '--checksum-mode', 'ENABLED')
        if head.get('ContentLength') != int(item['size']) or not head.get('Metadata', {}).get('source-sha256'):
            raise RuntimeError('Existing destination needs manual verification')
        return {'status': 'already_verified', 'bytes': item['size']}
    digest = hashlib.sha256()
    with tempfile.TemporaryDirectory(prefix='avanca-copy-') as directory:
        local = pathlib.Path(directory) / 'object'
        size = 0
        with urllib.request.urlopen(source['source'], timeout=120) as response, local.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > int(item['size']):
                    raise RuntimeError('Source size changed')
                digest.update(chunk)
                output.write(chunk)
        if size != int(item['size']):
            raise RuntimeError('Source size changed')
        checksum = base64.b64encode(digest.digest()).decode()
        cli('s3api', 'put-object', '--bucket', config['bucket'], '--key', key, '--body', str(local), '--content-type', item.get('mimetype') or 'application/octet-stream', '--checksum-sha256', checksum, '--metadata', json.dumps({'source-sha256': digest.hexdigest()}), '--if-none-match', '*')
        verified = cli('s3api', 'head-object', '--bucket', config['bucket'], '--key', key, '--checksum-mode', 'ENABLED')
        if verified.get('ContentLength') != size or verified.get('ChecksumSHA256') != checksum:
            raise RuntimeError('Destination checksum mismatch')
    return {'status': 'copied_verified', 'bytes': size}
results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(copy, item) for item in manifest]
    for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
        try:
            results.append(future.result())
        except Exception as error:
            # Do not log signed URLs, tokens, file names, credentials, or upstream response bodies.
            results.append({'status': 'failed', 'error_type': type(error).__name__})
        if i % 20 == 0 or i == len(manifest):
            print(json.dumps({'processed': i, 'total': len(manifest), 'failed': sum(r['status'] == 'failed' for r in results)}), flush=True)
print(json.dumps({'complete': all(r['status'] != 'failed' for r in results), 'verified': sum(r['status'] != 'failed' for r in results), 'failed': sum(r['status'] == 'failed' for r in results)}))
raise SystemExit(1 if any(r['status'] == 'failed' for r in results) else 0)
