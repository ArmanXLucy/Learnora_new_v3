const searchInput = document.getElementById('skill-search');
const resultsBox = document.getElementById('search-results');

if (searchInput) {
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = searchInput.value.trim();
    debounceTimer = setTimeout(() => runSearch(q), 200);
  });

  document.addEventListener('click', (e) => {
    if (!resultsBox.contains(e.target) && e.target !== searchInput) {
      resultsBox.style.display = 'none';
    }
  });
}

async function runSearch(q) {
  try {
    const res = await fetch(`/api/search-skills?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.length) {
      resultsBox.style.display = 'none';
      return;
    }
    resultsBox.innerHTML = data.map(item => `
      <div class="search-result-item" onclick="window.location.href='/skill/${item.id}/start'">
        <div class="name">${item.name}</div>
        <div class="desc">${item.description}</div>
      </div>
    `).join('');
    resultsBox.style.display = 'block';
  } catch (err) {
    console.error('Search failed', err);
  }
}
