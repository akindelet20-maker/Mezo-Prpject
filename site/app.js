(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const RPC = 'https://rpc.test.mezo.org';
  const EXPLORER = 'https://explorer.test.mezo.org';
  const CHAIN_ID = 31611n;
  const PUBLISHED_MUSD = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
  const TOKEN_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
  const store = { get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} } };
  const freshDemos = () => [
    { id: 'demo-1', name: 'Weekend Builders', symbol: 'dMUSD', contribution: '25', memberLimit: 6, duration: 604800, round: 1, paidCount: 5, status: 'active', members: ['Ada', 'Emeka', 'Zainab', 'Mina', 'Tobi', 'You'], userMember: true, userPaid: false, icon: '◎' },
    { id: 'demo-2', name: 'Family First', symbol: 'dMUSD', contribution: '10', memberLimit: 5, duration: 2592000, round: 0, paidCount: 0, status: 'open', members: ['Tobi', 'Mina', 'Ada'], userMember: false, userPaid: false, icon: '✳' },
    { id: 'demo-3', name: 'Rainy Day Crew', symbol: 'dMUSD', contribution: '15', memberLimit: 4, duration: 604800, round: 0, paidCount: 2, status: 'expired', members: ['Mina', 'You', 'Zainab', 'Emeka'], userMember: true, userPaid: true, icon: '◒' }
  ];
  const defaults = window.AJO_DEFAULTS || { factory: '', token: '', demoToken: false };
  const savedConfig = store.get('ajo-config-v1', null);
  const readProvider = window.ethers ? new ethers.JsonRpcProvider(RPC + '/', 31611, { staticNetwork: true }) : null;
  const state = { mode: 'demo', view: 'circles', demos: store.get('ajo-demo-v1', freshDemos()), activity: store.get('ajo-activity-v1', []), config: savedConfig?.factory && savedConfig?.token ? savedConfig : { ...defaults }, account: null, provider: readProvider, signer: null, chainTime: 0, live: [], loading: false, error: '', busy: false, selectedId: null, metadata: new Map() };
  if (!Array.isArray(state.demos) || !state.demos.length) state.demos = freshDemos();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Not connected';
  const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const durationLabel = seconds => seconds < 3600 ? `${seconds / 60}-minute rounds` : seconds < 86400 ? `${seconds / 3600}-hour rounds` : `${seconds / 86400}-day rounds`;
  const circles = () => state.mode === 'demo' ? state.demos : state.live;
  const getCircle = id => circles().find(c => String(c.id) === String(id));
  const isTimedOut = c => c.status === 'active' && c.deadline && state.chainTime > c.deadline;
  const displayStatus = c => isTimedOut(c) ? 'expired' : c.status;
  const statusText = c => ({ open: 'Filling up', active: 'Round in progress', completed: 'Cycle complete', expired: c.userPaid ? 'Refund available' : 'Timed out' }[displayStatus(c)] || 'Unknown');
  const persistDemos = () => store.set('ajo-demo-v1', state.demos);
  const persistConfig = () => store.set('ajo-config-v1', state.config);
  let toastTimer;
  function toast(message, hash) {
    $('toast').innerHTML = esc(message) + (hash && /^0x[0-9a-f]{64}$/i.test(hash) ? ` <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>` : '');
    $('toast').classList.add('visible'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), hash ? 12000 : 6500);
  }
  function activity(title, detail, hash = '', mode = state.mode, kind = '↗') {
    state.activity.unshift({ title, detail, hash, mode, kind, at: Date.now() });
    state.activity = state.activity.slice(0, 60); store.set('ajo-activity-v1', state.activity); renderActivity();
  }
  function errorMessage(error) { return error?.shortMessage || error?.info?.error?.message || error?.message || 'Something went wrong. Check your wallet and try again.'; }
  async function busy(button, fn) {
    if (state.busy) return toast('A wallet operation is already in progress. Check the existing request.');
    state.busy = true;
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.textContent = 'Waiting for wallet…'; }
    try { await fn(); } catch (error) { console.error(error); toast(errorMessage(error)); }
    finally { state.busy = false; if (button?.isConnected) { button.disabled = false; button.innerHTML = original; } updateWallet(); updateSetup(); }
  }
  async function confirmed(tx, title) {
    toast(`${title}: transaction submitted. Wait for confirmation before trying again.`, tx.hash);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Transaction did not succeed. Inspect the explorer before retrying.');
    return receipt;
  }
  function updateWallet() {
    $('connectButton').lastElementChild.textContent = state.account ? short(state.account) : 'Connect wallet';
    $('setupConnect').textContent = state.account ? `Connected: ${short(state.account)}` : 'Connect / switch network';
  }
  async function ensureWallet() {
    if (!window.ethereum || !window.ethers) throw new Error('No EVM wallet was found. Open this page in a wallet-enabled browser such as MetaMask. Never share a private key.');
    let chain = BigInt(await window.ethereum.request({ method: 'eth_chainId' }));
    if (chain !== CHAIN_ID) {
      try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7b7b' }] }); }
      catch (error) {
        if (error.code !== 4902 && error?.data?.originalError?.code !== 4902) throw error;
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x7b7b', chainName: 'Mezo Testnet', nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
        await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7b7b' }] });
      }
    }
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    state.provider = new ethers.BrowserProvider(window.ethereum);
    if (BigInt(await state.provider.send('eth_chainId', [])) !== CHAIN_ID) throw new Error('Please switch your wallet to Mezo Testnet (31611).');
    state.signer = await state.provider.getSigner(); state.account = await state.signer.getAddress();
    updateWallet(); return state.signer;
  }
  async function tokenMetadata(address) {
    const key = address.toLowerCase();
    if (state.metadata.has(key)) return state.metadata.get(key);
    const token = new ethers.Contract(address, TOKEN_ABI, state.provider);
    const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
    if (Number(decimals) > 36) throw new Error('This prototype supports token decimals from 0 to 36 only.');
    const data = { symbol: String(symbol).slice(0, 24), decimals: Number(decimals) }; state.metadata.set(key, data); return data;
  }
  async function ajo(write = false) {
    if (!state.config.factory) throw new Error('Set up a factory contract first.');
    if (write) await ensureWallet();
    if (!state.provider) throw new Error('Connect a wallet to read live Mezo testnet data.');
    return new ethers.Contract(state.config.factory, AJO_CONTRACTS.MusdAjo.abi, write ? state.signer : state.provider);
  }
  function renderCard(c) {
    const status = displayStatus(c), open = status === 'open', completed = status === 'completed';
    const current = open ? c.members.length : completed ? c.memberLimit : c.paidCount;
    const progress = Math.min(100, current / c.memberLimit * 100);
    const amount = Number(c.contribution), pot = amount * c.memberLimit;
    const initials = c.members.slice(0, 3).map(name => name.startsWith('0x') ? name.slice(2, 4).toUpperCase() : name.split(' ').map(n => n[0]).join('').slice(0, 2));
    const members = initials.map(i => `<span>${esc(i)}</span>`).join('') + `<span>+${Math.max(0, c.memberLimit - 3)}</span>`;
    const round = completed ? c.memberLimit : c.round + 1;
    return `<article class="circle-card ${status}"><div class="card-top"><span class="circle-symbol" aria-hidden="true">${esc(c.icon || '◎')}</span><span class="status-badge status-${status}">${esc(statusText(c))}</span></div><h3>${esc(c.name)}</h3><div class="card-meta">${esc(durationLabel(c.duration))}<span>·</span><span class="demo-small">${state.mode === 'demo' ? 'Sample circle' : `On-chain #${esc(c.id)}`}</span></div><div class="card-pot"><div><span>Round pot</span><strong>${number(pot)}<small>${esc(c.symbol)}</small></strong></div><span class="round-label">${number(amount)} ${esc(c.symbol)} / person<b>Round ${round} of ${c.memberLimit}</b></span></div><div class="progress"><span style="width:${progress}%"></span></div><div class="progress-meta"><strong>${open ? `${c.members.length} of ${c.memberLimit} places filled` : completed ? 'Every member received a pot' : status === 'expired' ? 'Incomplete round ended' : `${c.paidCount} of ${c.memberLimit} contributions`}</strong><span>${open ? `${c.memberLimit - c.members.length} places left` : completed ? 'Complete' : status === 'expired' ? c.userPaid ? 'Claim your payment' : 'Circle ended' : `${number(amount * c.paidCount)} collected`}</span></div><div class="members-row"><div class="member-avatars" aria-hidden="true">${members}</div><span>${c.members.length} members${state.mode === 'demo' ? ' · demo' : ''}</span></div><button class="card-action" data-circle="${esc(c.id)}">${status === 'expired' && c.userPaid ? 'View & claim refund' : 'View circle'}<span>↗</span></button></article>`;
  }
  function render() {
    $('demoMode').classList.toggle('selected', state.mode === 'demo'); $('liveMode').classList.toggle('selected', state.mode === 'live');
    $('circleCount').textContent = `${circles().length} circle${circles().length === 1 ? '' : 's'}`;
    $('workspaceSubtitle').textContent = state.mode === 'demo' ? 'Make progress with people in your corner.' : 'All circles in your selected Mezo testnet factory.';
    const text = state.mode === 'demo' ? '<strong>Take a look around.</strong> These are sample circles. Try a contribution or claim a refund — no funds involved.' : '<strong>Mezo testnet workspace.</strong> Transactions use your connected wallet. Test tokens only; no live MUSD integration.';
    $('modeNotice').querySelector('p').innerHTML = text;
    $('noticeSetup').innerHTML = state.mode === 'demo' ? 'Set up testnet <span>↗</span>' : 'Deployment settings <span>↗</span>';
    if (state.mode === 'live' && state.loading) $('circleGrid').innerHTML = '<div class="empty-state"><span>↻</span><h3>Reading Mezo testnet…</h3><p>Fetching circles from the factory selected in this browser.</p></div>';
    else if (state.mode === 'live' && state.error) $('circleGrid').innerHTML = `<div class="empty-state"><span>!</span><h3>Could not load testnet data</h3><p>${esc(state.error)}</p><button class="button button-dark" data-setup>Check testnet setup ↗</button></div>`;
    else if (!circles().length) {
      const needsSetup = state.mode === 'live' && (!state.config.factory || !state.account);
      const message = needsSetup ? (state.config.factory ? 'A shared Ajo factory and dMUSD demo token are deployed on Mezo testnet. Connect your wallet to mint demo tokens and create a circle.' : 'Connect a wallet, then deploy or choose a factory and an ERC-20 test token.') : 'No circles were found in this workspace. Create one and share its factory address and ID with your people.';
      $('circleGrid').innerHTML = `<div class="empty-state"><span>◎</span><h3>${needsSetup ? 'Your on-chain circle starts here.' : 'Room for a new beginning.'}</h3><p>${esc(message)}</p><button class="button button-dark" ${needsSetup ? 'data-setup' : 'data-create'}>${needsSetup ? 'Connect to Mezo testnet' : 'Create a circle'} ↗</button></div>`;
    }
    else $('circleGrid').innerHTML = circles().map(renderCard).join('');
    $('circlesView').classList.toggle('hidden', state.view !== 'circles'); $('activityView').classList.toggle('hidden', state.view !== 'activity');
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view)); renderActivity();
  }
  function renderActivity() {
    const entries = state.activity.filter(a => a.mode === state.mode);
    $('activityList').innerHTML = entries.length ? entries.map(a => `<div class="activity-row"><span class="activity-icon">${esc(a.kind)}</span><div><strong>${esc(a.title)}</strong><p>${esc(a.detail)}${a.mode === 'demo' ? ' · Simulated, not on-chain' : ''}</p>${a.hash ? `<a href="${EXPLORER}/tx/${esc(a.hash)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>` : ''}</div><small>${esc(new Date(a.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</small></div>`).join('') : '<div class="empty-state"><span>↗</span><h3>Every little step counts.</h3><p>Your actions in this browser appear here. Demo actions are always labeled simulated. Live confirmations link to the explorer.</p></div>';
  }
  async function loadLive() {
    state.error = '';
    if (!state.config.factory || !state.provider) { state.live = []; render(); return; }
    state.loading = true; render();
    try {
      if (BigInt(await state.provider.send('eth_chainId', [])) !== CHAIN_ID) throw new Error('Your wallet is on another network. Connect / switch to Mezo Testnet.');
      state.chainTime = Number((await state.provider.getBlock('latest')).timestamp);
      const contract = await ajo(); const count = Number(await contract.nextCircleId());
      const result = [];
      for (let id = Math.max(0, count - 30); id < count; id++) {
        const c = await contract.getCircle(id), metadata = await tokenMetadata(c.token);
        const member = state.account ? await contract.getMemberState(id, state.account) : { isMember: false, hasContributed: false, canRefund: false };
        result.push({ id, name: c.name, token: c.token, rawContribution: c.contribution, contribution: ethers.formatUnits(c.contribution, metadata.decimals), symbol: metadata.symbol, decimals: metadata.decimals, memberLimit: Number(c.memberLimit), duration: Number(c.roundDuration), deadline: Number(c.deadline), round: Number(c.round), paidCount: Number(c.paidCount), status: ['open', 'active', 'completed', 'expired'][Number(c.status)], members: Array.from(c.members), userMember: member.isMember, userPaid: member.hasContributed, canRefund: member.canRefund, icon: '◎' });
      }
      state.live = result.reverse();
      if (count > 30) toast('Showing the newest 30 circles in this factory.');
    } catch (error) { state.error = errorMessage(error); state.live = []; }
    finally { state.loading = false; render(); }
  }
  async function setMode(mode) { state.mode = mode; state.view = 'circles'; render(); if (mode === 'live') await loadLive(); }
  function updateSetup() {
    if (!$('setupDialog').open) return;
    $('mintToken').disabled = !state.config.demoToken || !state.config.token || state.busy;
    $('factoryAddress').closest('.setup-step').querySelector('p').textContent = state.config.factory ? 'Using the saved testnet factory below. Share its address with every member.' : 'No factory is selected. Use the shared default or deploy from your wallet, then share its address with your members.';
    if (state.config.factory && state.config.token) $('deploymentStatus').innerHTML = `Mezo testnet deployment: <a href="${EXPLORER}/address/${esc(state.config.factory)}" target="_blank" rel="noopener noreferrer">Ajo factory ↗</a> · <a href="${EXPLORER}/token/${esc(state.config.token)}" target="_blank" rel="noopener noreferrer">Test token ↗</a>. Configuration is stored only in this browser. Never enter a private key here.`;
  }
  function openSetup() {
    $('factoryAddress').value = state.config.factory || ''; $('tokenAddress').value = state.config.token || '';
    if (!$('setupDialog').open) $('setupDialog').showModal(); updateSetup();
  }
  async function openCreate() {
    if (state.mode === 'live' && (!state.config.factory || !state.config.token || !state.account)) { toast('Connect a wallet and choose a factory and test token before creating a live circle.'); openSetup(); return; }
    $('createDescription').textContent = state.mode === 'demo' ? 'Create a local preview circle. No wallet or funds are involved.' : 'Create a real circle on Mezo testnet. Your wallet will ask you to sign a transaction; testnet BTC is required for gas.';
    $('createSubmit').innerHTML = state.mode === 'demo' ? 'Create demo circle <span>↗</span>' : 'Create on Mezo testnet <span>↗</span>';
    let label = 'dMUSD · demo units';
    if (state.mode === 'live') { try { label = `${(await tokenMetadata(state.config.token)).symbol} · test token`; } catch (error) { toast(errorMessage(error)); return; } }
    $('createTokenLabel').textContent = label; $('createDialog').showModal();
  }
  function detail(id) {
    const c = getCircle(id); if (!c) return;
    state.selectedId = String(id); const status = displayStatus(c), live = state.mode === 'live';
    const names = c.members.map(name => live ? short(name) + (state.account && name.toLowerCase() === state.account.toLowerCase() ? ' (you)' : '') : name);
    let action = '', note = '';
    if (!live) {
      if (status === 'open') { action = c.userMember ? '<button class="button button-orange" data-action="fill">Fill demo places ↗</button>' : '<button class="button button-orange" data-action="join">Join demo circle ↗</button>'; note = 'Local simulation only. No funds, wallet or blockchain transaction.'; }
      else if (status === 'active') { action = `<button class="button button-orange" data-action="${c.userPaid ? 'finish' : 'contribute'}">${c.userPaid ? 'Simulate remaining members' : `Try ${number(c.contribution)} dMUSD contribution`} ↗</button>`; note = 'Local simulation only. A full demo pot automatically advances the round.'; }
      else if (status === 'expired' && c.userPaid) { action = '<button class="button button-orange" data-action="refund">Try refund ↩</button>'; note = 'Only your payment in this incomplete round is refundable. Previous payouts are not reversed.'; }
      else note = status === 'completed' ? 'Everyone received a pot. This sample cycle is complete.' : 'No refundable payment remains for you in this sample circle.';
      action += '<button class="button button-outline" data-action="reset">Reset demo</button>';
    } else {
      if (status === 'open' && !c.userMember) action = '<button class="button button-orange" data-action="join">Join circle ↗</button>';
      else if (status === 'active' && c.userMember && !c.userPaid) action = `<button class="button button-orange" data-action="contribute">Contribute ${number(c.contribution)} ${esc(c.symbol)} ↗</button>`;
      else if (status === 'expired' && c.userPaid) action = '<button class="button button-orange" data-action="refund">Claim current-round refund ↩</button>';
      else if (isTimedOut(c)) action = '<button class="button button-outline" data-action="expire">Mark circle expired ↗</button>';
      note = status === 'open' ? 'The round starts when all places are filled. Joining is permissionless; only share with people you trust.' : status === 'completed' ? 'Every member has received once. This cycle is complete.' : status === 'expired' ? 'This circle ended. Contributors can reclaim only their current incomplete-round payment.' : c.userPaid ? 'You have contributed this round. The next payout happens when every member contributes.' : 'You may need two wallet signatures: an exact-amount token approval, then the contribution. Both are on Mezo testnet.';
      action += '<button class="button button-outline" data-action="copy">Copy circle invite ↗</button>';
    }
    const deadline = live && c.deadline ? `<p class="detail-token">Round deadline (your local time): ${esc(new Date(c.deadline * 1000).toLocaleString())}</p>` : '';
    $('detailContent').innerHTML = `<div class="dialog-head"><div><span class="eyebrow">${live ? `MEZO TESTNET · CIRCLE #${esc(c.id)}` : 'SAMPLE CIRCLE · NOT ON-CHAIN'}</span><h2>${esc(c.name)}<span>.</span></h2></div><button class="close-button" data-close aria-label="Close dialog">×</button></div><span class="status-badge status-${status}">${esc(statusText(c))}</span><div class="detail-summary"><div><small>Per person / round</small><strong>${number(c.contribution)} <em>${esc(c.symbol)}</em></strong></div><div><small>Full round pot</small><strong>${number(Number(c.contribution) * c.memberLimit)} <em>${esc(c.symbol)}</em></strong></div><div><small>Current round</small><strong>${Math.min(c.round + 1, c.memberLimit)} <em>of ${c.memberLimit}</em></strong></div></div><div class="form-note">${esc(note)}</div>${deadline}<div class="member-list"><h3>Members & payout order · ${c.members.length}/${c.memberLimit}</h3>${names.map((name, index) => `<div class="member-item"><span>${index + 1}</span><div>${esc(name)}</div><small>${index < c.round ? 'Paid in an earlier round' : index === c.round && status !== 'completed' ? 'Next recipient' : 'Waiting for their turn'}</small></div>`).join('')}</div>${live ? `<p class="detail-token">Factory: <a href="${EXPLORER}/address/${esc(state.config.factory)}" target="_blank" rel="noopener noreferrer">${esc(short(state.config.factory))} ↗</a><br>Token: <a href="${EXPLORER}/token/${esc(c.token)}" target="_blank" rel="noopener noreferrer">${esc(c.token)} ↗</a></p>` : ''}<div class="detail-actions">${action}</div>`;
    if (!$('detailDialog').open) $('detailDialog').showModal();
  }
  function demoAction(action) {
    const c = getCircle(state.selectedId); if (!c) return;
    if (action === 'reset') { state.demos = freshDemos(); persistDemos(); $('detailDialog').close(); render(); toast('Sample circles reset. No blockchain transactions were made.'); return; }
    if (action === 'join') { c.members.push('You'); c.userMember = true; activity('Joined a demo circle', c.name, '', 'demo', '+'); if (c.members.length === c.memberLimit) c.status = 'active'; toast('Demo place joined. This is a local simulation only.'); }
    if (action === 'fill') { while (c.members.length < c.memberLimit) c.members.push(['Ada', 'Emeka', 'Zainab', 'Mina', 'Tobi'][c.members.length % 5]); c.status = 'active'; activity('Demo circle filled', c.name, '', 'demo', '+'); toast('Sample members joined. The first round is ready.'); }
    if (action === 'contribute') { c.userPaid = true; c.paidCount++; activity('Demo contribution made', `${number(c.contribution)} dMUSD · ${c.name}`, '', 'demo', '↗'); toast('Demo contribution recorded. No tokens were moved.'); }
    if (action === 'finish') c.paidCount = c.memberLimit;
    if ((action === 'contribute' || action === 'finish') && c.paidCount === c.memberLimit) {
      const recipient = c.members[c.round]; c.round++; c.paidCount = 0; c.userPaid = false; if (c.round >= c.memberLimit) c.status = 'completed';
      activity('Demo pot paid automatically', `${number(Number(c.contribution) * c.memberLimit)} dMUSD to ${recipient} · ${c.name}`, '', 'demo', '✓'); toast(`Full sample pot paid to ${recipient}. ${c.status === 'completed' ? 'The demo cycle is complete.' : 'The next round has started.'} No tokens moved.`);
    }
    if (action === 'refund') { c.userPaid = false; c.paidCount--; activity('Demo refund claimed', `${number(c.contribution)} dMUSD · ${c.name}`, '', 'demo', '↩'); toast(`Sample refund of ${number(c.contribution)} dMUSD claimed. No tokens were moved.`); }
    persistDemos(); render(); detail(c.id);
  }
  async function liveAction(action, button) {
    const c = getCircle(state.selectedId); if (!c) return;
    if (action === 'copy') { try { await navigator.clipboard.writeText(`MUSD Ajo · Mezo Testnet (31611)\nFactory: ${state.config.factory}\nCircle ID: ${c.id}\nPage: ${location.origin}\nUse test tokens only; not audited.`); toast('Factory address and circle ID copied. Share both with your members.'); } catch { toast(`Circle ID: ${c.id}. Factory: ${state.config.factory}`); } return; }
    await busy(button, async () => {
      const contract = await ajo(true); let tx, title;
      if (action === 'join') { tx = await contract.joinCircle(c.id); title = 'Joined circle'; }
      else if (action === 'contribute') {
        const token = new ethers.Contract(c.token, TOKEN_ABI, state.signer);
        const balance = await token.balanceOf(state.account); if (balance < c.rawContribution) throw new Error(`Insufficient ${c.symbol}. Mint demo tokens or obtain test tokens first.`);
        if (await token.allowance(state.account, state.config.factory) < c.rawContribution) {
          toast('Approve only this contribution amount in your wallet. A second signature will send the contribution.');
          const approval = await token.approve(state.config.factory, c.rawContribution); await confirmed(approval, 'Token approval'); activity('Exact-amount approval confirmed', `${number(c.contribution)} ${c.symbol}`, approval.hash, 'live');
        }
        tx = await contract.contribute(c.id); title = 'Contribution confirmed';
      } else if (action === 'refund') { tx = await contract.claimRefund(c.id); title = 'Refund confirmed'; }
      else if (action === 'expire') { tx = await contract.expireCircle(c.id); title = 'Circle marked expired'; }
      else return;
      await confirmed(tx, title); activity(title, `${c.name} · Circle #${c.id}`, tx.hash, 'live', action === 'refund' ? '↩' : '↗');
      await loadLive(); detail(c.id); toast(title, tx.hash);
    });
  }
  $('createForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.target);
    const name = String(form.get('name')).trim(), amount = String(form.get('amount')), members = Number(form.get('members')), duration = Number(form.get('duration'));
    if (!name || new TextEncoder().encode(name).length > 64) return toast('Use a circle name between 1 and 64 UTF-8 bytes.');
    if (!(Number(amount) > 0) || !Number.isFinite(Number(amount)) || !Number.isInteger(members) || members < 2 || members > 20) return toast('Enter a positive contribution and 2–20 members.');
    if (state.mode === 'demo') {
      const id = `demo-${Date.now()}`; state.demos.unshift({ id, name, symbol: 'dMUSD', contribution: amount, memberLimit: members, duration, round: 0, paidCount: 0, status: 'open', members: ['You'], userMember: true, userPaid: false, icon: '◎' }); persistDemos(); activity('Created a demo circle', name, '', 'demo', '+'); $('createDialog').close(); render(); toast('Demo circle created. Fill its places to simulate the first round.'); detail(id); return;
    }
    await busy($('createSubmit'), async () => {
      const contract = await ajo(true); const metadata = await tokenMetadata(state.config.token);
      if (state.config.token.toLowerCase() === PUBLISHED_MUSD.toLowerCase()) throw new Error('Published testnet MUSD is not enabled in this prototype. Use a separately deployed demo token.');
      const parsed = ethers.parseUnits(amount, metadata.decimals); if (parsed <= 0n) throw new Error('Contribution must be positive.');
      const tx = await contract.createCircle(name, state.config.token, parsed, members, duration); const receipt = await confirmed(tx, 'Create circle');
      const eventLog = receipt.logs.map(log => { try { return contract.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === 'CircleCreated');
      activity('Circle created on Mezo testnet', `${name}${eventLog ? ` · #${eventLog.args.circleId}` : ''}`, tx.hash, 'live', '+'); $('createDialog').close(); await loadLive(); if (eventLog) detail(Number(eventLog.args.circleId)); toast('Circle created on Mezo testnet.', tx.hash);
    });
  });
  $('saveSetup').addEventListener('click', () => busy($('saveSetup'), async () => {
    const factory = $('factoryAddress').value.trim(), token = $('tokenAddress').value.trim();
    if (!window.ethers || !ethers.isAddress(factory) || !ethers.isAddress(token)) throw new Error('Enter valid factory and ERC-20 test-token addresses, or deploy them using the buttons above.');
    if (token.toLowerCase() === PUBLISHED_MUSD.toLowerCase()) throw new Error('The published testnet MUSD address is not enabled. Use a separately deployed demo token.');
    await ensureWallet();
    if (await state.provider.getCode(factory) === '0x') throw new Error('No factory contract code exists at that address on Mezo testnet.');
    if (await state.provider.getCode(token) === '0x') throw new Error('No token contract code exists at that address on Mezo testnet.');
    await new ethers.Contract(factory, AJO_CONTRACTS.MusdAjo.abi, state.provider).nextCircleId();
    const metadata = await tokenMetadata(token);
    state.config = { factory: ethers.getAddress(factory), token: ethers.getAddress(token), demoToken: state.config.demoToken && state.config.token?.toLowerCase() === token.toLowerCase() }; persistConfig();
    $('setupDialog').close(); await setMode('live'); toast(`Saved Mezo testnet deployment. Token: ${metadata.symbol}. Contract presence and interface checked; not a security audit.`);
  }));
  async function deployContract(name, button) {
    await busy(button, async () => {
      await ensureWallet(); const artifact = AJO_CONTRACTS[name];
      const deployed = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, state.signer).deploy(); const tx = deployed.deploymentTransaction();
      await confirmed(tx, name === 'MusdAjo' ? 'Ajo factory deployment' : 'Demo token deployment'); await deployed.waitForDeployment(); const address = await deployed.getAddress();
      if (name === 'MusdAjo') { state.config.factory = address; $('factoryAddress').value = address; }
      else { state.config.token = address; state.config.demoToken = true; $('tokenAddress').value = address; }
      persistConfig(); $('deploymentStatus').textContent = `${name === 'MusdAjo' ? 'Ajo factory' : 'dMUSD demo token'} deployed on Mezo testnet: ${address}. Copy and share this public address.`;
      activity(`${name === 'MusdAjo' ? 'Ajo factory' : 'dMUSD demo token'} deployed`, address, tx.hash, 'live', '+'); toast('Deployment confirmed on Mezo testnet.', tx.hash);
    });
  }
  $('deployFactory').addEventListener('click', () => deployContract('MusdAjo', $('deployFactory')));
  $('deployToken').addEventListener('click', () => deployContract('DemoMUSD', $('deployToken')));
  $('mintToken').addEventListener('click', () => busy($('mintToken'), async () => {
    if (!state.config.demoToken || !state.config.token) throw new Error('Deploy a dMUSD demo token in this browser first.');
    await ensureWallet(); const token = new ethers.Contract(state.config.token, AJO_CONTRACTS.DemoMUSD.abi, state.signer);
    const tx = await token.mint(state.account, ethers.parseEther('1000')); await confirmed(tx, 'Mint demo tokens'); activity('Minted 1,000 dMUSD demo tokens', 'Demo only — no value, not official MUSD', tx.hash, 'live', '+'); toast('1,000 dMUSD demo tokens minted. Not official MUSD; no monetary value.', tx.hash);
  }));
  const connect = button => busy(button, async () => { await ensureWallet(); toast('Wallet connected to Mezo testnet. No transaction was signed.'); if (state.mode === 'live') await loadLive(); });
  $('connectButton').addEventListener('click', () => connect($('connectButton'))); $('setupConnect').addEventListener('click', () => connect($('setupConnect')));
  $('setupButton').addEventListener('click', openSetup); $('noticeSetup').addEventListener('click', openSetup); $('integrationDetails').addEventListener('click', openSetup);
  $('demoMode').addEventListener('click', () => setMode('demo')); $('liveMode').addEventListener('click', () => setMode('live'));
  $('refreshButton').addEventListener('click', () => state.mode === 'live' ? loadLive() : (render(), toast('Sample workspace refreshed. No blockchain data was loaded.')));
  document.addEventListener('click', event => {
    const create = event.target.closest('[data-create]'); if (create) { openCreate(); return; }
    const setup = event.target.closest('[data-setup]'); if (setup) { openSetup(); return; }
    const close = event.target.closest('[data-close]'); if (close) { close.closest('dialog').close(); return; }
    const card = event.target.closest('[data-circle]'); if (card) { detail(card.dataset.circle); return; }
    const nav = event.target.closest('[data-view]'); if (nav) { state.view = nav.dataset.view; render(); $('workspace').scrollIntoView({ behavior: 'smooth' }); return; }
    const action = event.target.closest('[data-action]'); if (action) { state.mode === 'demo' ? demoAction(action.dataset.action) : liveAction(action.dataset.action, action); }
  });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', () => { state.account = null; state.provider = readProvider; state.signer = null; state.live = []; updateWallet(); if (state.mode === 'live') loadLive(); });
    window.ethereum.on('chainChanged', () => { state.account = null; state.provider = readProvider; state.signer = null; state.live = []; updateWallet(); if (state.mode === 'live') loadLive(); });
  }
  render(); updateWallet();
})();
