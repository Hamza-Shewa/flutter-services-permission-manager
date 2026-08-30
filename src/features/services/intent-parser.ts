export function extractApplinkIntents(content: string): { hosts: string[]; schemes: string[] } {
    const intentRegex = /<intent-filter[^>]*>([\s\S]*?)<\/intent-filter>/gi;
    const hosts: string[] = [];
    const schemes: string[] = [];

    let intentMatch: RegExpExecArray | null;
    while ((intentMatch = intentRegex.exec(content)) !== null) {
        const body = intentMatch[1];

        // Require VIEW action and both DEFAULT and BROWSABLE categories to reduce false positives
        const hasViewAction = /<action[^>]*android:name=["']android\.intent\.action\.VIEW["'][^>]*>/i.test(body);
        const hasDefaultCategory = /<category[^>]*android:name=["']android\.intent\.category\.DEFAULT["'][^>]*>/i.test(body);
        const hasBrowsableCategory = /<category[^>]*android:name=["']android\.intent\.category\.BROWSABLE["'][^>]*>/i.test(body);
        if (!hasViewAction || !hasDefaultCategory || !hasBrowsableCategory) {
            continue;
        }

        const dataRegex = /<data[^>]*>/gi;
        let dataMatch: RegExpExecArray | null;
        while ((dataMatch = dataRegex.exec(body)) !== null) {
            const dataTag = dataMatch[0];
            const hostMatch = dataTag.match(/android:host=["']([^"']+)["']/i);
            const schemeMatch = dataTag.match(/android:scheme=["']([^"']+)["']/i);
            const host = hostMatch?.[1];
            const scheme = schemeMatch?.[1];

            // Skip OAuth-style authorize hosts
            if (host && host.toLowerCase() === 'authorize') {
                continue;
            }

            if (host) {hosts.push(host);}
            if (scheme) {schemes.push(scheme);}
        }
    }

    return { hosts: Array.from(new Set(hosts)), schemes: Array.from(new Set(schemes)) };
}
