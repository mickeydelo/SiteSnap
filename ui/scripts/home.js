    async function boot() {
      const list = document.getElementById('sites');
      try {
        const [sitesResponse, healthResponse] = await Promise.all([
          fetch('/api/sites'),
          fetch('/api/health', { cache: 'no-store' }),
        ]);
        if (!sitesResponse.ok) throw new Error(`HTTP ${sitesResponse.status}`);
        if (!healthResponse.ok) throw new Error(`HTTP ${healthResponse.status}`);
        const sites = await sitesResponse.json();
        const health = await healthResponse.json();
        document.getElementById('runtime-note').lastChild.textContent = health.mode === 'local'
          ? ' Local capture keeps screenshots on this computer.'
          : (health.captureEnabled
            ? ' Hosted Chromium capture is enabled; local mode remains available.'
            : ' Hosted capture needs a connected Vercel Blob store.');
        if (!sites.length) {
          list.innerHTML = '<div class="loading">No capture projects are configured.</div>';
          return;
        }
        list.innerHTML = '';
        sites.forEach(site => {
          const card = document.createElement('article');
          card.className = 'site-card';
          if (site.imageUrl) {
            const image = document.createElement('img');
            image.className = 'site-image';
            image.src = site.imageUrl;
            image.alt = `${site.name} capture preview`;
            image.width = 1200;
            image.height = 675;
            image.loading = 'eager';
            image.decoding = 'async';
            card.appendChild(image);
          }
          const body = document.createElement('div');
          body.className = 'site-body';
          const copy = document.createElement('div');
          const title = document.createElement('h3');
          title.textContent = site.name;
          const description = document.createElement('p');
          description.textContent = site.description || site.primaryUrl || '';
          copy.append(title, description);
          const launch = document.createElement('a');
          launch.className = 'launch';
          launch.href = `/run.html?site=${encodeURIComponent(site.id)}`;
          launch.setAttribute('aria-label', `Configure ${site.name}`);
          launch.append('Configure ', Object.assign(document.createElement('span'), { textContent: '→' }));
          body.append(copy, launch);
          card.appendChild(body);
          list.appendChild(card);
        });
      } catch (error) {
        list.innerHTML = `<div class="error">Could not load capture projects: ${escapeHtml(error.message)}</div>`;
      }
    }
    boot();
