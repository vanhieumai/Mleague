document.addEventListener('DOMContentLoaded', () => {
    const setupView = document.getElementById('setup-view');
    const scheduleView = document.getElementById('schedule-view');
    const setupForm = document.getElementById('setup-form');
    const teamCountInput = document.getElementById('team-count');
    const groupCountInput = document.getElementById('group-count');
    const gamesInput = document.getElementById('games-per-team');
    const weeksInput = document.getElementById('week-count');
    const matchList = document.getElementById('match-list');
    const teamProfile = document.getElementById('team-profile');
    const teamFilter = document.getElementById('team-filter');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const modalForm = document.getElementById('modal-form');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const toast = document.getElementById('toast');

    const state = {
        teams: Array.from({ length: 11 }, (_, index) => `Đội ${index + 1}`),
        groupCount: 1,
        gamesPerTeam: 4,
        rounds: 5,
        league: 'Giải đấu mới',
        season: 'Mùa giải mới',
        organization: '',
        startDate: '',
        endDate: '',
        sport: '',
        contact: '',
        draft: false,
        scoring: getSportPreset(''),
        teamColors: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`Đội ${index + 1}`, '#42a34f'])),
        teamColorMode: 'hidden',
        roundSchedules: {},
        competitionType: 'round-robin',
        homeAwayEnabled: false,
        bracketFormat: 'single',
        bracketConsolation: 'none',
        bracketThirdPlaceEnabled: false,
        thirdPlaceGame: null,
        advanceEnabled: false,
        advanceBranches: [{ start: 1, end: 4, format: 'bracket', thirdPlace: false }],
        advanceFixtureRoundModes: {},
        advanceFixtureSchedules: {},
        advanceFixtureResults: {},
        bracketGames: [],
        matches: []
    };
    let activeModal = '';
    let editingMatchIndex = -1;
    let editingRound = -1;
    let checkerMode = 'opponents';
    let checkerTotals = true;
    let settingsDraft = null;
    let toastTimer;
    let currentUser = null;
    let currentLeagueId = null;
    let currentShareId = null;
    let readOnlyView = false;
    let authMode = 'signin';
    let firebaseServicesPromise = null;
    let autoSaveTimer;
    let firebaseApp;
    let savingLeague = false;
    let activeTeamName = '';
    let sidePanelCollapsed = false;
    let bracketExpanded = false;
    let editingAdvanceFixtureCode = '';
    let editingAdvanceFixtureLegIndex = -1;

    function firebaseConfigReady() {
        const config = window.MLEAGUE_FIREBASE_CONFIG;
        return Boolean(config && config.apiKey && config.authDomain && config.projectId && config.appId);
    }

    function updateAccountNavigation() {
        const accountLink = document.getElementById('account-profile-button');
        const displayName = currentUser && (currentUser.displayName || currentUser.email);
        accountLink.textContent = displayName || 'ĐĂNG NHẬP';
        accountLink.title = currentUser
            ? 'Mở thông tin tài khoản'
            : 'Đăng nhập hoặc tạo tài khoản';
        document.getElementById('sign-out').classList.toggle('hidden', !currentUser || readOnlyView);
        document.getElementById('my-schedules').classList.toggle('hidden', readOnlyView);
    }

    async function getFirebaseServices() {
        if (!firebaseConfigReady()) {
            throw new Error('Firebase chưa được cấu hình. Hãy hoàn tất firebase-config.js theo hướng dẫn trước khi dùng tài khoản.');
        }
        if (!firebaseServicesPromise) {
            firebaseServicesPromise = Promise.all([
                import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
                import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
            ]).then(([appSdk, authSdk, firestoreSdk]) => {
                firebaseApp = appSdk.getApps().length
                    ? appSdk.getApp()
                    : appSdk.initializeApp(window.MLEAGUE_FIREBASE_CONFIG);
                return { ...appSdk, ...authSdk, ...firestoreSdk, auth: authSdk.getAuth(firebaseApp), db: firestoreSdk.getFirestore(firebaseApp) };
            }).catch(error => {
                firebaseServicesPromise = null;
                throw new Error(`Không thể tải Firebase SDK: ${error.message}`);
            });
        }
        return firebaseServicesPromise;
    }

    if (firebaseConfigReady()) {
        getFirebaseServices().then(services => {
            services.onAuthStateChanged(services.auth, user => {
                currentUser = user;
                updateAccountNavigation();
            });
        }).catch(error => showToast(error.message));
    }
    void loadSharedLeagueFromUrl();

    function firebaseErrorMessage(error) {
        const messages = {
            'auth/email-already-in-use': 'Email này đã được đăng ký.',
            'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
            'auth/weak-password': 'Mật khẩu cần có ít nhất 6 ký tự.',
            'auth/invalid-credential': 'Email hoặc mật khẩu không chính xác.',
            'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hóa.',
            'auth/too-many-requests': 'Có quá nhiều lần thử. Hãy đợi rồi thử lại.',
            'permission-denied': 'Firebase từ chối thao tác. Hãy kiểm tra Firestore Rules.',
            'unavailable': 'Không thể kết nối Firebase. Hãy kiểm tra mạng và cấu hình dự án.'
        };
        return messages[error.code] || error.message || 'Thao tác Firebase thất bại.';
    }

    async function signOutUser() {
        try {
            window.clearTimeout(autoSaveTimer);
            const services = await getFirebaseServices();
            await services.signOut(services.auth);
            currentUser = null;
            currentLeagueId = null;
            currentShareId = null;
            updateAccountNavigation();
            showToast('Đã đăng xuất.');
        } catch (error) {
            showToast(firebaseErrorMessage(error));
        }
    }

    async function openMySchedules() {
        if (!currentUser) {
            authMode = 'signin';
            openModal('auth');
            showToast('Đăng nhập để xem các giải đấu đã lưu.');
            return;
        }
        openModal('my-schedules');
        try {
            const services = await getFirebaseServices();
            const saved = await services.getDocs(services.collection(services.db, 'users', currentUser.uid, 'leagues'));
            if (saved.empty) {
                modalContent.innerHTML = '<div class="saved-leagues-empty">Bạn chưa lưu giải đấu nào. Tạo lịch rồi chọn “Lưu giải đấu” để bắt đầu.</div>';
                return;
            }
            modalContent.innerHTML = `<div class="saved-leagues">${saved.docs.map(document => {
                const league = document.data();
                const shareId = league.shareId || '';
                return `<article class="saved-league">
                    <div class="saved-league-info">
                        <strong>${escapeHtml(league.title || 'Giải đấu')}</strong>
                        <small>Cập nhật ${escapeHtml(formatSavedDate(league.updatedAt))}${shareId ? ' · Đang chia sẻ công khai' : ''}</small>
                    </div>
                    <div class="saved-league-actions">
                        <button class="button button-outline" type="button" data-action="open-saved-league" data-league-id="${escapeHtml(document.id)}">Mở</button>
                        ${shareId ? `<button class="button button-outline" type="button" data-action="copy-share-link" data-share-id="${escapeHtml(shareId)}">Sao chép link</button>
                        <button class="button button-text" type="button" data-action="unpublish-league" data-league-id="${escapeHtml(document.id)}" data-share-id="${escapeHtml(shareId)}">Tắt chia sẻ</button>` : ''}
                        <button class="button button-text saved-league-delete" type="button" data-action="delete-saved-league" data-league-id="${escapeHtml(document.id)}">Xóa</button>
                    </div>
                </article>`;
            }).join('')}</div>`;
        } catch (error) {
            modalContent.innerHTML = `<p class="saved-leagues-error">${escapeHtml(firebaseErrorMessage(error))}</p>`;
            showToast(firebaseErrorMessage(error));
        }
    }

    function formatSavedDate(timestamp) {
        const date = timestamp && typeof timestamp.toDate === 'function' ? timestamp.toDate() : null;
        return date ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(date) : 'vừa xong';
    }

    function serializeLeague() {
        return JSON.parse(JSON.stringify(state));
    }

    function serializePublicLeague() {
        const league = serializeLeague();
        delete league.contact;
        return league;
    }

    async function saveCurrentLeague(title = state.league) {
        if (!currentUser) throw new Error('Đăng nhập để lưu giải đấu.');
        window.clearTimeout(autoSaveTimer);
        const services = await getFirebaseServices();
        state.league = title;
        if (state.draft && currentShareId) {
            await services.deleteDoc(services.doc(services.db, 'publicLeagues', currentShareId));
            currentShareId = null;
            showToast('Đã tắt liên kết chia sẻ vì giải đấu được chuyển về bản nháp.');
        }
        const reference = currentLeagueId
            ? services.doc(services.db, 'users', currentUser.uid, 'leagues', currentLeagueId)
            : services.doc(services.collection(services.db, 'users', currentUser.uid, 'leagues'));
        currentLeagueId = reference.id;
        const payload = {
            ownerUid: currentUser.uid,
            title,
            data: serializeLeague(),
            shareId: currentShareId,
            updatedAt: services.serverTimestamp()
        };
        savingLeague = true;
        try {
            await services.setDoc(reference, payload, { merge: true });
            if (currentShareId) await updatePublicLeague(services);
            renderSchedule();
        } finally {
            savingLeague = false;
        }
    }

    async function updatePublicLeague(services) {
        if (!currentShareId) return;
        await services.setDoc(services.doc(services.db, 'publicLeagues', currentShareId), {
            ownerUid: currentUser.uid,
            published: true,
            league: serializePublicLeague(),
            updatedAt: services.serverTimestamp()
        }, { merge: true });
    }

    function scheduleAutoSave() {
        window.clearTimeout(autoSaveTimer);
        autoSaveTimer = window.setTimeout(() => {
            saveCurrentLeague().catch(error => showToast(`Không thể tự lưu: ${firebaseErrorMessage(error)}`));
        }, 800);
    }

    async function openSavedLeague(leagueId) {
        if (!currentUser || !leagueId) throw new Error('Không tìm thấy giải đấu trong tài khoản.');
        const services = await getFirebaseServices();
        const reference = services.doc(services.db, 'users', currentUser.uid, 'leagues', leagueId);
        const snapshot = await services.getDoc(reference);
        if (!snapshot.exists()) throw new Error('Giải đấu đã bị xóa hoặc bạn không còn quyền truy cập.');
        const savedLeague = snapshot.data();
        applyLeagueData(savedLeague.data, { leagueId, shareId: savedLeague.shareId || null, readOnly: false });
    }

    async function deleteSavedLeague(leagueId) {
        if (!currentUser) throw new Error('Hãy đăng nhập lại để xóa giải đấu.');
        window.clearTimeout(autoSaveTimer);
        const services = await getFirebaseServices();
        const reference = services.doc(services.db, 'users', currentUser.uid, 'leagues', leagueId);
        const snapshot = await services.getDoc(reference);
        if (snapshot.exists() && snapshot.data().shareId) {
            await services.deleteDoc(services.doc(services.db, 'publicLeagues', snapshot.data().shareId));
        }
        await services.deleteDoc(reference);
        if (currentLeagueId === leagueId) {
            currentLeagueId = null;
            currentShareId = null;
        }
    }

    async function unpublishLeague(leagueId, shareId) {
        if (!currentUser) throw new Error('Hãy đăng nhập lại để tắt chia sẻ.');
        const services = await getFirebaseServices();
        await services.deleteDoc(services.doc(services.db, 'publicLeagues', shareId));
        await services.updateDoc(
            services.doc(services.db, 'users', currentUser.uid, 'leagues', leagueId),
            { shareId: null, updatedAt: services.serverTimestamp() }
        );
        if (currentLeagueId === leagueId) currentShareId = null;
    }

    async function copyShareLink(shareId) {
        const url = new URL(window.location.href);
        url.search = '';
        url.searchParams.set('share', shareId);
        try {
            await navigator.clipboard.writeText(url.toString());
            showToast('Đã sao chép liên kết chỉ xem.');
        } catch (error) {
            showToast('Không sao chép được liên kết. Hãy kiểm tra quyền clipboard của trình duyệt.');
        }
    }

    async function shareSchedule() {
        if (readOnlyView) return;
        if (state.draft) {
            showToast('Hãy bỏ trạng thái bản nháp trước khi chia sẻ công khai.');
            return;
        }
        if (!currentUser) {
            authMode = 'signin';
            openModal('auth');
            showToast('Đăng nhập để tạo liên kết chia sẻ.');
            return;
        }
        try {
            const services = await getFirebaseServices();
            if (!currentLeagueId) await saveCurrentLeague(state.league);
            if (!currentShareId) {
                const reference = services.doc(services.collection(services.db, 'publicLeagues'));
                currentShareId = reference.id;
                await services.setDoc(reference, {
                    ownerUid: currentUser.uid,
                    published: true,
                    league: serializePublicLeague(),
                    updatedAt: services.serverTimestamp()
                });
                await services.updateDoc(
                    services.doc(services.db, 'users', currentUser.uid, 'leagues', currentLeagueId),
                    { shareId: currentShareId, updatedAt: services.serverTimestamp() }
                );
            } else {
                await updatePublicLeague(services);
            }
            openModal('share-link');
        } catch (error) {
            showToast(firebaseErrorMessage(error));
        }
    }

    async function loadSharedLeagueFromUrl() {
        const shareId = new URLSearchParams(window.location.search).get('share');
        if (!shareId) return;
        try {
            const services = await getFirebaseServices();
            const snapshot = await services.getDoc(services.doc(services.db, 'publicLeagues', shareId));
            if (!snapshot.exists() || !snapshot.data().published || !snapshot.data().league) {
                throw new Error('Liên kết giải đấu không tồn tại hoặc đã bị chủ giải tắt.');
            }
            applyLeagueData(snapshot.data().league, { shareId, readOnly: true });
        } catch (error) {
            showToast(firebaseErrorMessage(error));
        }
    }

    function applyLeagueData(data, options) {
        if (!data || !Array.isArray(data.teams) || data.teams.length < 2 || data.teams.length > 50 ||
            !data.teams.every(team => typeof team === 'string') ||
            !Array.isArray(data.matches) || data.matches.length > 5000 ||
            !Number.isInteger(data.rounds) || data.rounds < 1 || data.rounds > 50 ||
            data.matches.some(match => !match || !data.teams.includes(match.home) ||
                !data.teams.includes(match.away) || !Number.isInteger(match.round) ||
                match.round < 1 || match.round > data.rounds)) {
            throw new Error('Dữ liệu giải đấu không hợp lệ.');
        }
        state.teams = data.teams;
        state.matches = data.matches;
        state.groupCount = Number.isInteger(data.groupCount) &&
            data.groupCount >= 1 && data.groupCount <= Math.floor(state.teams.length / 2)
            ? data.groupCount
            : 1;
        state.gamesPerTeam = Number(data.gamesPerTeam) || 1;
        state.rounds = data.rounds;
        state.league = String(data.league || 'Giải đấu');
        state.season = String(data.season || '');
        state.organization = String(data.organization || '');
        state.startDate = String(data.startDate || '');
        state.endDate = String(data.endDate || '');
        state.sport = String(data.sport || '');
        state.contact = '';
        state.draft = Boolean(data.draft);
        const preset = getSportPreset(state.sport);
        state.scoring = data.scoring &&
            [data.scoring.win, data.scoring.draw, data.scoring.loss].every(Number.isFinite) &&
            Array.isArray(data.scoring.ranking)
            ? { ...preset, ...data.scoring }
            : preset;
        state.teamColors = data.teamColors || {};
        state.teamColorMode = data.teamColorMode || 'hidden';
        state.roundSchedules = data.roundSchedules || {};
        state.competitionType = data.competitionType === 'bracket' ? 'bracket' : 'round-robin';
        if (state.competitionType === 'bracket') state.groupCount = 1;
        state.homeAwayEnabled = data.homeAwayEnabled === true;
        state.bracketFormat = data.bracketFormat === 'double' ? 'double' : 'single';
        state.bracketThirdPlaceEnabled = data.bracketThirdPlaceEnabled === true ||
            data.bracketConsolation === 'third-place';
        state.bracketConsolation = data.bracketConsolation === 'full' ? 'full' : 'none';
        state.bracketGames = state.competitionType === 'bracket' && validBracketGames(data.bracketGames, data.teams, state.homeAwayEnabled)
            ? data.bracketGames.map(game => ({ ...game }))
            : state.competitionType === 'bracket' ? buildBracketGames(data.teams) : [];
        state.thirdPlaceGame = state.competitionType === 'bracket'
            ? validThirdPlaceGame(data.thirdPlaceGame, data.teams, state.homeAwayEnabled)
                ? { ...data.thirdPlaceGame }
                : createEmptyBracketGame()
            : null;
        if (state.competitionType === 'bracket') resolveBracketProgression();
        state.advanceEnabled = Boolean(data.advanceEnabled) &&
            state.competitionType === 'round-robin';
        const maxGroupRank = Math.floor(state.teams.length / state.groupCount);
        const savedBranches = Array.isArray(data.advanceBranches)
            ? data.advanceBranches
            : (Number.isInteger(data.advanceTeamCount)
                ? [{ start: 1, end: data.advanceTeamCount, format: data.advanceFormat }]
                : []);
        state.advanceBranches = savedBranches
            .filter(branch => branch && Number.isInteger(branch.start) && Number.isInteger(branch.end) &&
                branch.start >= 1 && branch.end <= maxGroupRank &&
                (branch.end - branch.start + 1) * state.groupCount >= 2)
            .map(branch => ({
                start: branch.start,
                end: branch.end,
                format: branch.format === 'round-robin' ? 'round-robin' : 'bracket',
                thirdPlace: branch.format !== 'round-robin' && branch.thirdPlace === true &&
                    branch.end - branch.start + 1 >= 4
            }));
        state.advanceFixtureSchedules = data.advanceFixtureSchedules &&
            typeof data.advanceFixtureSchedules === 'object' && !Array.isArray(data.advanceFixtureSchedules)
            ? Object.fromEntries(Object.entries(data.advanceFixtureSchedules).filter(([, schedule]) =>
                schedule && typeof schedule.date === 'string' && typeof schedule.time === 'string' &&
                validDateTime(schedule.date, schedule.time) && schedule.date && schedule.time))
            : {};
        state.advanceFixtureRoundModes = data.advanceFixtureRoundModes &&
            typeof data.advanceFixtureRoundModes === 'object' && !Array.isArray(data.advanceFixtureRoundModes)
            ? Object.fromEntries(Object.entries(data.advanceFixtureRoundModes).filter(([key, enabled]) =>
                /^N\d+-V\d+$/.test(key) && enabled === true))
            : {};
        state.advanceFixtureResults = data.advanceFixtureResults &&
            typeof data.advanceFixtureResults === 'object' && !Array.isArray(data.advanceFixtureResults)
            ? Object.fromEntries(Object.entries(data.advanceFixtureResults).filter(([, result]) =>
                result && typeof result.home === 'string' && typeof result.away === 'string' &&
                validAdvanceScorePair(result.homeScore, result.awayScore, 1998) &&
                (!result.legs || validAdvanceFixtureLegs(result.legs)) &&
                (result.winner === null || typeof result.winner === 'string')))
            : {};
        if (!state.advanceBranches.length) {
            state.advanceBranches = [{
                start: 1,
                end: Math.min(state.groupCount > 1 ? 2 : 4, maxGroupRank),
                format: 'bracket',
                thirdPlace: false
            }];
        }
        window.clearTimeout(autoSaveTimer);
        currentLeagueId = options.leagueId || null;
        currentShareId = options.shareId || null;
        readOnlyView = Boolean(options.readOnly);
        setupView.classList.add('hidden');
        scheduleView.classList.remove('hidden');
        document.querySelector('.site-footer').classList.add('hidden');
        populateFilter();
        renderSchedule();
    }

    document.querySelectorAll('.step-button').forEach(button => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.target);
            const nextValue = Number(input.value) + Number(button.dataset.step);
            input.value = Math.max(Number(input.min), Math.min(Number(input.max), nextValue));
            if (input === teamCountInput || input === groupCountInput) updateBracketSetup();
        });
    });
    document.querySelectorAll('[name="competition-type"], [name="home-away-enabled"], [name="bracket-format"], [name="bracket-consolation"], [name="bracket-third-place"], [name="advance-enabled"]').forEach(input => {
        input.addEventListener('change', updateBracketSetup);
    });
    teamCountInput.addEventListener('input', updateBracketSetup);
    teamCountInput.addEventListener('change', updateBracketSetup);
    groupCountInput.addEventListener('input', updateBracketSetup);
    groupCountInput.addEventListener('change', updateBracketSetup);
    gamesInput.addEventListener('input', updateBracketSetup);
    weeksInput.addEventListener('input', updateBracketSetup);
    document.getElementById('advance-branches').addEventListener('change', () => {
        state.advanceBranches = readAdvanceBranches();
        updateBracketSetup(false);
    });
    document.getElementById('add-advance-branch').addEventListener('click', () => {
        const teamCount = Number(teamCountInput.value);
        const groupCount = Number(groupCountInput.value) || 1;
        const branches = readAdvanceBranches();
        const nextStart = Math.max(...branches.map(branch => branch.end)) + 1;
        const maxRank = Math.floor(teamCount / groupCount);
        const minRankSpan = groupCount > 1 ? 1 : 2;
        if (!Number.isInteger(teamCount) || nextStart + minRankSpan - 1 > maxRank) return;
        state.advanceBranches = branches.concat({
            start: nextStart,
            end: Math.min(nextStart + Math.max(3, minRankSpan - 1), maxRank),
            format: 'bracket',
            thirdPlace: false
        });
        renderAdvanceBranches();
    });
    document.getElementById('advance-branches').addEventListener('click', event => {
        const removeButton = event.target.closest('[data-action="remove-advance-branch"]');
        if (!removeButton) return;
        const branches = readAdvanceBranches();
        branches.splice(Number(removeButton.dataset.index), 1);
        state.advanceBranches = branches.length ? branches : [{ start: 1, end: Math.min(2, Number(teamCountInput.value)), format: 'bracket', thirdPlace: false }];
        renderAdvanceBranches();
    });
    renderAdvanceBranches();
    updateBracketSetup();

    function readAdvanceBranches() {
        return [...document.querySelectorAll('.advance-branch')].map((branch, index) => ({
            start: Number(branch.querySelector(`[name="advance-start-${index}"]`).value),
            end: Number(branch.querySelector(`[name="advance-end-${index}"]`).value),
            format: branch.querySelector(`[name="advance-format-${index}"]`).value,
            thirdPlace: branch.querySelector(`[name="advance-third-place-${index}"]`).checked
        }));
    }

    function renderAdvanceBranches() {
        const container = document.getElementById('advance-branches');
        const maxRank = Math.max(2, Math.floor(Number(teamCountInput.value) / Number(groupCountInput.value || 1)));
        container.innerHTML = state.advanceBranches.map((branch, index) => `
            <section class="advance-branch">
                <div class="advance-branch-heading">
                    <strong>Nhánh ${index + 1}</strong>
                    ${index > 0 ? `<button class="button button-text remove-advance-branch" type="button" data-action="remove-advance-branch" data-index="${index}" aria-label="Xóa nhánh ${index + 1}"><i class="fa-solid fa-trash-can"></i> Xóa</button>` : ''}
                </div>
                <div class="advance-branch-fields">
                    <label class="advance-field"><span class="advance-rank-label" data-default-label="Hạng từ" data-group-label="Hạng từ mỗi bảng">${Number(groupCountInput.value) > 1 ? 'Hạng từ mỗi bảng' : 'Hạng từ'}</span>
                        <input name="advance-start-${index}" type="number" min="1" max="${maxRank}" value="${branch.start}" required>
                    </label>
                    <label class="advance-field"><span class="advance-rank-label" data-default-label="Đến hạng" data-group-label="Đến hạng mỗi bảng">${Number(groupCountInput.value) > 1 ? 'Đến hạng mỗi bảng' : 'Đến hạng'}</span>
                        <input name="advance-end-${index}" type="number" min="${Number(groupCountInput.value) > 1 ? branch.start : branch.start + 1}" max="${maxRank}" value="${branch.end}" required>
                    </label>
                    <label class="advance-field">Thể thức
                        <select name="advance-format-${index}">
                            <option value="bracket"${branch.format === 'bracket' ? ' selected' : ''}>Loại trực tiếp</option>
                            <option value="round-robin"${branch.format === 'round-robin' ? ' selected' : ''}>Vòng tròn</option>
                        </select>
                    </label>
                    <label class="advance-third-place-toggle">
                        <input name="advance-third-place-${index}" type="checkbox"${branch.thirdPlace ? ' checked' : ''}>
                        <span>Tranh hạng ba</span>
                        <small class="advance-third-place-help">Cần ít nhất 4 đội trong nhánh.</small>
                    </label>
                </div>
            </section>`).join('');
        updateAdvanceBranchActions();
    }

    function updateAdvanceBranchActions() {
        const teamCount = Number(teamCountInput.value);
        const groupCount = Number(groupCountInput.value) || 1;
        const maxRank = Math.max(2, Math.floor(teamCount / groupCount));
        const minRankSpan = groupCount > 1 ? 1 : 2;
        const branches = readAdvanceBranches();
        const addButton = document.getElementById('add-advance-branch');
        const nextStart = branches.length ? Math.max(...branches.map(item => item.end)) + 1 : 1;
        addButton.disabled = !Number.isInteger(teamCount) || nextStart + minRankSpan - 1 > maxRank;
        document.querySelectorAll('.advance-branch').forEach((branch, index) => {
            const format = branch.querySelector(`[name="advance-format-${index}"]`).value;
            const start = Number(branch.querySelector(`[name="advance-start-${index}"]`).value);
            const end = Number(branch.querySelector(`[name="advance-end-${index}"]`).value);
            const option = branch.querySelector('.advance-third-place-toggle');
            const checkbox = branch.querySelector(`[name="advance-third-place-${index}"]`);
            const eligible = format === 'bracket' && (end - start + 1) * groupCount >= 4;
            option.classList.toggle('hidden', format !== 'bracket');
            if (!eligible) checkbox.checked = false;
            checkbox.disabled = !eligible || !new FormData(setupForm).has('advance-enabled');
            option.querySelector('.advance-third-place-help').classList.toggle('hidden',
                (end - start + 1) * groupCount >= 4);
        });
    }

    function updateBracketSetup(refreshBranches = true) {
        const formData = new FormData(setupForm);
        const isBracket = formData.get('competition-type') === 'bracket';
        const homeAwayEnabled = formData.has('home-away-enabled');
        const advanceEnabled = !isBracket && formData.has('advance-enabled');
        const teamCount = Number(teamCountInput.value);
        const maxGroupCount = Number.isInteger(teamCount) && teamCount >= 2
            ? Math.floor(teamCount / 2)
            : 1;
        groupCountInput.max = String(maxGroupCount);
        if (Number(groupCountInput.value) > maxGroupCount) groupCountInput.value = String(maxGroupCount);
        const groupCount = Math.max(1, Math.min(maxGroupCount, Number(groupCountInput.value) || 1));
        const groupSizes = getGroupSizes(teamCount, groupCount);
        const smallestGroupSize = groupSizes.length ? Math.min(...groupSizes) : 2;
        const hasOddGroup = groupSizes.some(size => size % 2 === 1);
        const bracketOptions = document.getElementById('bracket-options');
        bracketOptions.classList.toggle('hidden', !isBracket);
        document.getElementById('round-robin-advanced').classList.toggle('hidden', isBracket);
        document.getElementById('groups-setup-row').classList.toggle('hidden', isBracket);
        document.getElementById('advance-options').classList.toggle('hidden', !advanceEnabled);
        document.getElementById('games-setup-row').classList.toggle('hidden', isBracket);
        document.getElementById('rounds-setup-row').classList.toggle('hidden', isBracket);
        groupCountInput.disabled = isBracket;
        gamesInput.disabled = isBracket;
        weeksInput.disabled = isBracket;
        const maxGames = maxGamesPerTeam(teamCount, Number(weeksInput.value), homeAwayEnabled, groupCount);
        const minimumGames = homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
        const gamesStep = homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
        const incompatibleGroups = homeAwayEnabled && maxGames < minimumGames;
        gamesInput.min = String(minimumGames);
        gamesInput.max = String(Math.max(minimumGames, maxGames));
        gamesInput.step = String(gamesStep);
        weeksInput.min = String(minimumRoundsForGames(
            Number.isInteger(teamCount) ? teamCount : 2,
            Number(gamesInput.value) || 1,
            homeAwayEnabled,
            groupCount
        ));
        document.getElementById('home-away-description').textContent = homeAwayEnabled
            ? 'Mỗi cặp gặp nhau hai trận, đổi sân; loại trực tiếp tính tổng tỉ số sau hai lượt.'
            : 'Vòng tròn: một trận mỗi cặp. Loại trực tiếp: một trận mỗi vòng.';
        document.getElementById('games-per-team-help').textContent = homeAwayEnabled
            ? incompatibleGroups
                ? 'Số đội trong các bảng không tương thích với số trận đi-về bằng nhau; hãy đổi số bảng.'
                : hasOddGroup
                ? 'Số trận mỗi đội; do có bảng lẻ đội, chọn bội số của 4 để mỗi cặp gặp đúng hai lần.'
                : 'Số trận mỗi đội; chọn số chẵn để mỗi đối thủ gặp hai lần.'
            : 'Tổng số trận mỗi đội chơi trong mùa giải.';
        document.getElementById('advance-description').textContent = groupCount > 1
            ? 'Chọn thứ hạng ở mỗi bảng để ghép các đội vào vòng tiếp theo.'
            : 'Lấy các đội đứng đầu bảng xếp hạng vòng tròn vào vòng tiếp theo.';
        document.getElementById('advance-help').textContent = groupCount > 1
            ? 'Mỗi nhánh lấy các thứ hạng đã chọn ở tất cả các bảng; các khoảng hạng không được trùng.'
            : 'Đội được lấy theo thứ hạng hiện tại; mỗi đội chỉ thuộc một nhánh.';
        document.getElementById('round-robin-tip').textContent = groupCount > 1
            ? `Các đội được chia cân bằng vào ${groupCount} bảng và chỉ gặp đối thủ trong cùng bảng.`
            : 'Trong bảng, các đội chỉ có thể gặp một đối thủ một lần ở vòng tròn một lượt.';
        document.querySelectorAll('#advance-branches .advance-rank-label').forEach(label => {
            label.textContent = groupCount > 1
                ? label.dataset.groupLabel
                : label.dataset.defaultLabel;
        });
        if (refreshBranches && Number.isInteger(teamCount) && teamCount >= 2 && teamCount <= 50) {
            const maxRank = Math.max(2, smallestGroupSize);
            const minRankSpan = groupCount > 1 ? 1 : 2;
            state.advanceBranches = state.advanceBranches.reduce((branches, branch) => {
                const start = Math.max(branch.start, branches.length ? branches[branches.length - 1].end + 1 : 1);
                if (start + minRankSpan - 1 > maxRank) return branches;
                branches.push({
                    ...branch,
                    start,
                    end: Math.min(Math.max(branch.end, start + minRankSpan - 1), maxRank)
                });
                return branches;
            }, []);
            if (!state.advanceBranches.length) {
                state.advanceBranches = [{
                    start: 1,
                    end: Math.min(groupCount > 1 ? 2 : 4, maxRank),
                    format: 'bracket',
                    thirdPlace: false
                }];
            }
            renderAdvanceBranches();
        } else {
            updateAdvanceBranchActions();
        }
        document.querySelectorAll('#advance-branches input, #advance-branches select').forEach(input => {
            input.disabled = !advanceEnabled;
        });
        updateAdvanceBranchActions();
        document.getElementById('add-advance-branch').disabled =
            !advanceEnabled || document.getElementById('add-advance-branch').disabled;
        const format = String(formData.get('bracket-format') || 'single');
        const consolation = String(formData.get('bracket-consolation') || 'none');
        document.querySelectorAll('[name="bracket-consolation"]').forEach(input => {
            input.disabled = format === 'double';
        });
        document.getElementById('bracket-third-place').disabled =
            !Number.isInteger(teamCount) || teamCount < 4;
        const description = format === 'double'
            ? 'Thể thức loại kép đã có nhánh thua.'
            : ({
                none: 'Chỉ tạo nhánh vô địch; đội thua bị loại.',
                full: 'Đội thua tiếp tục ở nhánh phụ để xếp hạng; số vòng phụ sẽ tùy thuộc số đội.'
            }[consolation]);
        document.getElementById('consolation-description').textContent = description;
        document.getElementById('bracket-third-place-description').textContent = teamCount >= 4
            ? 'Hai đội thua ở bán kết thi đấu thêm một trận.'
            : 'Cần ít nhất 4 đội để tổ chức trận tranh hạng ba.';
        const hint = document.getElementById('setup-hint');
        hint.textContent = isBracket
            ? 'Nhập kết quả ở từng trận; đội thắng sẽ tự chuyển vào vòng kế tiếp.'
            : groupCount > 1
                ? `MLeague sẽ chia đều đội vào ${groupCount} bảng và phân bổ lịch riêng cho từng bảng.`
                : 'MLeague sẽ phân bổ đều số trận và lượt nghỉ giữa các đội.';
        document.querySelector('.tip-box').classList.toggle('hidden', isBracket);
        document.getElementById('create-schedule-button').innerHTML = isBracket
            ? 'Tạo sơ đồ nhánh <i class="fa-solid fa-arrow-right"></i>'
            : 'Tiếp tục tạo lịch <i class="fa-solid fa-arrow-right"></i>';
        const preview = document.getElementById('bracket-preview');
        if (isBracket && (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 50)) {
            preview.innerHTML = '<p class="bracket-preview-note">Nhập số đội hợp lệ từ 2 đến 50 để xem trước nhánh đấu.</p>';
            return;
        }
        preview.innerHTML = isBracket
            ? bracketMarkup(
                teamCount,
                format,
                format === 'double' ? 'none' : consolation,
                true,
                Array.from({ length: teamCount }, (_, index) => state.teams[index] || `Đội ${index + 1}`),
                formData.has('bracket-third-place')
            )
            : '';
    }

    function bracketSeedOrder(size) {
        let seeds = [1, 2];
        while (seeds.length < size) {
            const nextSize = seeds.length * 2;
            seeds = seeds.flatMap(seed => [seed, nextSize + 1 - seed]);
        }
        return seeds;
    }

    function bracketMarkup(teamCount, format, consolation, compact = false, teamNames = state.teams, thirdPlace = false) {
        const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(2, teamCount)));
        const roundCount = Math.ceil(Math.log2(bracketSize));
        const seedOrder = bracketSeedOrder(bracketSize);
        const seeded = Array.from({ length: bracketSize }, (_, index) => {
            const seed = seedOrder[index];
            return seed <= teamCount ? teamNames[seed - 1] || `Đội ${seed}` : '';
        });
        let roundEntries = seeded;
        const winnerRounds = [];
        for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
            const count = bracketSize / (2 ** (roundIndex + 1));
            const nextEntries = [];
            const cards = Array.from({ length: count }, (_, matchIndex) => {
                const first = roundEntries[matchIndex * 2];
                const second = roundEntries[matchIndex * 2 + 1];
                if (!first || !second) {
                    nextEntries.push(first || second || '');
                    return `<article class="bracket-match-card${roundIndex > 0 ? ' bracket-tbd' : ''}">
                        <span>${escapeHtml(first || 'BYE')}</span>
                        <span>${escapeHtml(second || 'BYE')}</span>
                    </article>`;
                }
                nextEntries.push(`Thắng vòng ${roundIndex + 1} · trận ${matchIndex + 1}`);
                return `<article class="bracket-match-card${roundIndex > 0 ? ' bracket-tbd' : ''}">
                    <span>${escapeHtml(first)}</span>
                    <span>${escapeHtml(second)}</span>
                </article>`;
            }).join('');
            winnerRounds.push(`<div class="bracket-round-column"><h4>${getBracketRoundName(roundIndex + 1, roundCount)}</h4>${cards}</div>`);
            roundEntries = nextEntries;
        }

        let lowerBracket = '';
        if (format === 'double') {
            const lowerRounds = Math.max(1, (roundCount - 1) * 2);
            lowerBracket = `<section class="bracket-lower-section"><h3>Nhánh thua</h3><div class="bracket-rounds">${Array.from({ length: lowerRounds }, (_, index) => {
                const matchCount = Math.max(1, Math.floor(bracketSize / (2 ** (Math.ceil((index + 2) / 2) + 1))));
                return `<div class="bracket-round-column"><h4>Nhánh thua ${index + 1}</h4>${Array.from({ length: matchCount }, (_, matchIndex) =>
                    `<article class="bracket-match-card bracket-tbd"><span>Đội thua nhánh trên</span><span>Đội thắng nhánh dưới</span></article>`
                ).join('')}</div>`;
            }).join('')}</div><p>Đội bị loại khi thua lần thứ hai; đội thắng nhánh trên và nhánh thua gặp nhau ở chung kết.</p></section>`;
        } else if (consolation === 'full' && roundCount > 1) {
            const lowerRounds = roundCount - 1;
            lowerBracket = `<section class="bracket-lower-section"><h3>Nhánh consolation đầy đủ</h3><div class="bracket-rounds">${Array.from({ length: lowerRounds }, (_, index) => {
                const matchCount = Math.max(1, Math.floor(teamCount / (2 ** (index + 2))));
                return `<div class="bracket-round-column"><h4>Nhánh phụ ${index + 1}</h4>${Array.from({ length: matchCount }, () =>
                    `<article class="bracket-match-card bracket-tbd"><span>Đội thua nhánh chính</span><span>Đội thắng nhánh phụ</span></article>`
                ).join('')}</div>`;
            }).join('')}</div><p>Các đội thua được chuyển vào nhánh phụ để tiếp tục thi đấu.</p></section>`;
        }
        if (thirdPlace && teamCount >= 4) {
            lowerBracket += `<section class="bracket-lower-section third-place-preview"><h3>Tranh hạng ba</h3><article class="bracket-match-card bracket-tbd"><span>Đội thua bán kết 1</span><span>Đội thua bán kết 2</span></article></section>`;
        }

        return `<div class="bracket-preview-heading"><strong>${format === 'double' ? 'Loại kép' : 'Loại đơn'}</strong><span>${teamCount} đội · ${roundCount} vòng nhánh chính</span></div>
            <div class="bracket-rounds${compact ? ' bracket-rounds-compact' : ''}">${winnerRounds.join('')}</div>
            ${lowerBracket}
            <p class="bracket-preview-note">Đội được xếp theo thứ tự danh sách hiện tại. BYE là lượt miễn đấu do số đội không đủ lấp đầy nhánh.</p>`;
    }

    function interactiveBracketMarkup() {
        const rounds = Math.ceil(Math.log2(state.teams.length));
        const size = 2 ** rounds;
        const rowsPerColumn = size / 2;
        const columns = Array.from({ length: rounds }, (_, roundIndex) => {
            const games = state.bracketGames.filter(game => game.round === roundIndex + 1);
            const title = getBracketRoundName(roundIndex + 1, rounds);
            const pendingGames = games.filter(game => game.home && game.away &&
                !(Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore))).length;
            const randomGames = games.filter(game => game.randomResult).length;
            const previousRoundComplete = roundIndex === 0 ||
                state.bracketGames
                    .filter(game => game.round === roundIndex)
                    .every(game => game.winner);
            return `<section class="bracket-round-column">
                <div class="bracket-round-heading">
                    <h3>${state.bracketFormat === 'double' ? `Nhánh thắng · ${title}` : title}</h3>
                    ${!readOnlyView ? `<button class="random-round-button" type="button"
                        data-random-bracket-round="${roundIndex + 1}" ${pendingGames && previousRoundComplete ? '' : 'disabled'}
                        aria-label="Tạo kết quả ngẫu nhiên vòng ${roundIndex + 1}">
                        <i class="fa-solid fa-dice"></i><span>Random</span>
                    </button>
                    <button class="clear-random-button" type="button"
                        data-clear-bracket-round="${roundIndex + 1}" ${randomGames ? '' : 'disabled'}
                        aria-label="Xóa kết quả random vòng ${roundIndex + 1}">
                        <i class="fa-solid fa-eraser"></i><span>Clear</span>
                    </button>` : ''}
                </div>
                <div class="bracket-round-track" style="--bracket-row-count:${rowsPerColumn}">
                    ${games.filter(game => game.round !== 1 || (game.home && game.away)).map(game => {
                        const ready = Boolean(game.home && game.away);
                        const homeSource = state.bracketGames.find(previous =>
                            previous.round === game.round - 1 && previous.position === game.position * 2);
                        const awaySource = state.bracketGames.find(previous =>
                            previous.round === game.round - 1 && previous.position === game.position * 2 + 1);
                        const homeName = game.home || `Thắng ${homeSource ? bracketMatchCode(homeSource) : 'trận trước'}`;
                        const awayName = game.away || `Thắng ${awaySource ? bracketMatchCode(awaySource) : 'trận trước'}`;
                        const homeHadBye = Boolean(game.home && homeSource && homeSource.winner === game.home &&
                            (!homeSource.home || !homeSource.away));
                        const awayHadBye = Boolean(game.away && awaySource && awaySource.winner === game.away &&
                            (!awaySource.home || !awaySource.away));
                        const winnerClass = game.winner ? ' bracket-winner' : '';
                        const score = Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore);
                        const schedule = state.homeAwayEnabled ? '' : formatMatchDateTime(game.date, game.time);
                        const matchCode = bracketMatchCode(game);
                        const label = `${matchCode}, ${title}: ${homeName} gặp ${awayName}`;
                        return `<button class="bracket-match-card${ready ? ' bracket-editable' : ''}${winnerClass}"
                                type="button" data-bracket-game="${state.bracketGames.indexOf(game)}"
                                data-round-index="${game.round}" data-position="${game.position}"
                                style="--bracket-row-start:${game.position * (2 ** (game.round - 1)) + 1};--bracket-row-span:${2 ** (game.round - 1)}"
                                aria-label="${escapeHtml(label)}"${!ready || readOnlyView ? ' disabled' : ''}>
                            <span class="bracket-match-code">${matchCode}</span>
                            <span class="bracket-team${game.winner && game.winner === game.home ? ' bracket-team-winner' : ''}">
                                ${teamLabel(homeName, 'home')}
                                <b>${score ? game.homeScore : ''}</b>
                            </span>
                            <span class="bracket-team${game.winner && game.winner === game.away ? ' bracket-team-winner' : ''}">
                                ${teamLabel(awayName, 'away')}
                                <b>${score ? game.awayScore : ''}</b>
                            </span>
                            ${homeHadBye || awayHadBye
                                ? `<small class="bracket-game-status">${[homeHadBye ? `${escapeHtml(game.home)} miễn vòng ${game.round - 1}` : '', awayHadBye ? `${escapeHtml(game.away)} miễn vòng ${game.round - 1}` : ''].filter(Boolean).join(' · ')}</small>`
                                : ''}
                            ${state.homeAwayEnabled ? bracketLegDetailsMarkup(game) :
                                (schedule ? `<small class="bracket-game-schedule"><i class="fa-regular fa-clock"></i> ${escapeHtml(schedule)}</small>` : '')}
                            ${game.comment ? `<small class="bracket-game-comment">${escapeHtml(game.comment)}</small>` : ''}
                            ${ready && !game.winner && score && game.homeScore === game.awayScore
                                ? '<small class="bracket-game-status">Chọn đội thắng để đi tiếp</small>' : ''}
                        </button>`;
                    }).join('')}
                </div>
            </section>`;
        }).join('');
        const format = state.bracketFormat === 'double' ? 'Loại kép' : 'Loại đơn';
        let consolationPreview = '';
        if (state.bracketFormat === 'double' ||
            state.bracketConsolation === 'full') {
            const preview = document.createElement('template');
            preview.innerHTML = bracketMarkup(
                state.teams.length,
                state.bracketFormat,
                state.bracketFormat === 'double' ? 'none' : state.bracketConsolation
            );
            const lowerBracket = preview.content.querySelector('.bracket-lower-section');
            if (lowerBracket) {
                consolationPreview = `<div class="bracket-static-supplement">${lowerBracket.outerHTML}<p class="bracket-preview-note">Các trận nhánh phụ hiện là sơ đồ tham khảo; nhập tỷ số ở nhánh chính.</p></div>`;
            }
        }
        if (state.bracketThirdPlaceEnabled && state.teams.length >= 4) {
            consolationPreview += `<div class="bracket-static-supplement"><section class="bracket-lower-section third-place-preview">
                <h3>Tranh hạng ba</h3>${thirdPlaceMatchMarkup()}
            </section></div>`;
        }
        return `<div class="bracket-display-heading">
                <div><h2 class="bracket-display-title">Sơ đồ nhánh đấu</h2><p>${format}${state.bracketFormat === 'double' ? ' · Nhánh thắng' : ''} · ${state.teams.length} đội · ${rounds} vòng</p></div>
                <div class="bracket-display-actions">
                    <span><i class="fa-solid fa-circle-info"></i> Mã trận giúp theo dõi đội đi tiếp</span>
                    <button class="round-icon-button bracket-expand-button" type="button" data-action="toggle-bracket-expanded"
                        aria-label="${bracketExpanded ? 'Thu nhỏ sơ đồ' : 'Phóng to sơ đồ'}"
                        title="${bracketExpanded ? 'Thu nhỏ sơ đồ' : 'Phóng to sơ đồ'}"><i class="fa-solid fa-${bracketExpanded ? 'compress' : 'expand'}"></i></button>
                </div>
            </div>
            <div class="bracket-rounds bracket-rounds-live" style="--bracket-row-count:${rowsPerColumn};--bracket-round-count:${rounds}">
                <svg class="bracket-connectors" aria-hidden="true"></svg>
                ${columns}
            </div>
            ${consolationPreview}
            ${state.bracketFormat !== 'double' && state.bracketGames.some(game => game.winner && game.round === rounds)
                ? `<div class="bracket-champion"><i class="fa-solid fa-trophy"></i> Vô địch: <strong>${escapeHtml(state.bracketGames.find(game => game.round === rounds).winner)}</strong></div>` : ''}
            <p class="bracket-preview-note">Các đội được miễn vòng đầu xuất hiện từ vòng kế tiếp. ${state.homeAwayEnabled
                ? 'Tỉ số trên sơ đồ là tổng hai lượt.'
                : ''} Khi nhập tỉ số hòa, hãy chọn đội thắng để cập nhật nhánh.</p>`;
    }

    function thirdPlaceMatchMarkup() {
        const game = state.thirdPlaceGame || createEmptyBracketGame();
        const ready = Boolean(game.home && game.away);
        const scored = Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore);
        const schedule = state.homeAwayEnabled ? '' : formatMatchDateTime(game.date, game.time);
        return `<button class="bracket-match-card${ready ? ' bracket-editable' : ' bracket-tbd'}${game.winner ? ' bracket-winner' : ''}"
                type="button" data-third-place-match aria-label="Trận tranh hạng ba: ${escapeHtml(game.home || 'Chờ đội thua bán kết 1')} gặp ${escapeHtml(game.away || 'Chờ đội thua bán kết 2')}"
                ${!ready || readOnlyView ? ' disabled' : ''}>
            <span class="bracket-match-code">Trận tranh hạng ba</span>
            <span class="bracket-team${game.winner === game.home ? ' bracket-team-winner' : ''}">
                ${escapeHtml(game.home || 'Đội thua bán kết 1')}<b>${scored ? game.homeScore : ''}</b>
            </span>
            <span class="bracket-team${game.winner === game.away ? ' bracket-team-winner' : ''}">
                ${escapeHtml(game.away || 'Đội thua bán kết 2')}<b>${scored ? game.awayScore : ''}</b>
            </span>
            ${state.homeAwayEnabled ? bracketLegDetailsMarkup(game) :
                (schedule ? `<small class="bracket-game-schedule"><i class="fa-regular fa-clock"></i> ${escapeHtml(schedule)}</small>` : '')}
            ${game.comment ? `<small class="bracket-game-comment">${escapeHtml(game.comment)}</small>` : ''}
        </button>`;
    }

    function bracketLegDetailsMarkup(game) {
        return (game.legs || []).map((leg, index) => {
            const score = Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore)
                ? ` · ${leg.homeScore}–${leg.awayScore}`
                : '';
            const schedule = formatMatchDateTime(leg.date, leg.time);
            return `<small class="bracket-game-schedule">${index === 0 ? 'Lượt đi' : 'Lượt về · đổi sân'}${score}${schedule ? ` · ${escapeHtml(schedule)}` : ''}</small>`;
        }).join('');
    }

    function bracketMatchCode(game) {
        return `V${game.round}-M${String(game.position + 1).padStart(2, '0')}`;
    }

    function drawBracketConnectors() {
        const rounds = matchList.querySelector('.bracket-rounds-live');
        if (!rounds) return;
        const svg = rounds.querySelector('.bracket-connectors');
        const rect = rounds.getBoundingClientRect();
        const fitScale = scheduleView.classList.contains('bracket-expanded')
            ? Number.parseFloat(getComputedStyle(rounds).getPropertyValue('--bracket-fit-scale')) || 1
            : 1;
        const width = rounds.scrollWidth;
        const height = rounds.scrollHeight;
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const paths = [];
        matchList.querySelectorAll('[data-bracket-game]').forEach(game => {
            const round = Number(game.dataset.roundIndex);
            if (round >= state.rounds) return;
            const next = matchList.querySelector(`[data-round-index="${round + 1}"][data-position="${Math.floor(Number(game.dataset.position) / 2)}"]`);
            if (!next) return;
            const first = game.getBoundingClientRect();
            const second = next.getBoundingClientRect();
            const x1 = (first.right - rect.left + rounds.scrollLeft) / fitScale;
            const y1 = (first.top + first.height / 2 - rect.top + rounds.scrollTop) / fitScale;
            const x2 = (second.left - rect.left + rounds.scrollLeft) / fitScale;
            const y2 = (second.top + second.height / 2 - rect.top + rounds.scrollTop) / fitScale;
            const middle = x1 + (x2 - x1) / 2;
            paths.push(`<path d="M${x1} ${y1} H${middle} V${y2} H${x2}"/>`);
        });
        svg.innerHTML = paths.join('');
    }

    function fitBracketToViewport() {
        const rounds = matchList.querySelector('.bracket-rounds-live');
        if (!rounds || !scheduleView.classList.contains('bracket-expanded')) return;
        rounds.style.setProperty('--bracket-fit-scale', '1');
        const availableWidth = Math.max(0, window.innerWidth - 48);
        const availableHeight = Math.max(0, window.innerHeight - 80);
        const scale = Math.min(
            1,
            availableWidth / rounds.scrollWidth,
            availableHeight / rounds.scrollHeight
        );
        rounds.style.setProperty('--bracket-fit-scale', String(Math.max(0.1, scale)));
    }

    setupForm.addEventListener('submit', event => {
        event.preventDefault();
        const teamCount = Number(teamCountInput.value);
        const formData = new FormData(setupForm);
        const competitionType = String(formData.get('competition-type'));
        const homeAwayEnabled = formData.has('home-away-enabled');
        const groupCount = Number(groupCountInput.value);
        const games = Number(gamesInput.value);
        const rounds = Number(weeksInput.value);
        if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 50) {
            showToast('Số đội phải từ 2 đến 50.');
            return;
        }
        if (competitionType === 'round-robin' &&
            (!Number.isInteger(groupCount) || groupCount < 1 || groupCount > Math.floor(teamCount / 2))) {
            showToast(`Số bảng phải từ 1 đến ${Math.floor(teamCount / 2)} để mỗi bảng có ít nhất 2 đội.`);
            return;
        }
        if (competitionType === 'round-robin') {
            const groupSizes = getGroupSizes(teamCount, groupCount);
            const hasOddGroup = groupSizes.some(size => size % 2 === 1);
            const minimumRounds = homeAwayEnabled ? 2 : 1;
            if (!Number.isInteger(rounds) || rounds < minimumRounds || rounds > 50) {
                showToast(`Số tuần / vòng phải từ ${minimumRounds} đến 50.`);
                return;
            }
            const minimumGames = homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
            const gamesStep = homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
            const requiredRounds = minimumRoundsForGames(teamCount, games, homeAwayEnabled, groupCount);
            const maxGames = maxGamesPerTeam(teamCount, rounds, homeAwayEnabled, groupCount);
            if (homeAwayEnabled && maxGames < minimumGames) {
                showToast('Số đội trong các bảng không tương thích với thể thức lượt đi, lượt về. Hãy đổi số bảng hoặc tắt lượt đi, lượt về.');
                return;
            }
            if (homeAwayEnabled && Number.isInteger(games) && games >= minimumGames &&
                games % gamesStep === 0 && requiredRounds <= 50 &&
                rounds < requiredRounds) {
                showToast(`Với ${groupCount} bảng và ${games} trận mỗi đội, cần ít nhất ${requiredRounds} vòng để xếp đủ hai lượt.`);
                return;
            }
            if (!Number.isInteger(games) || games < minimumGames || games > maxGames ||
                homeAwayEnabled && games % gamesStep !== 0) {
                showToast(`Số trận mỗi đội cần là ${homeAwayEnabled
                    ? (hasOddGroup ? 'bội số của 4' : 'số chẵn từ 2')
                    : 'số nguyên từ 1'} đến ${maxGames}.`);
                return;
            }
        }
        const advanceEnabled = competitionType === 'round-robin' && formData.has('advance-enabled');
        const advanceBranches = advanceEnabled ? readAdvanceBranches() : [];
        const occupiedRanks = new Set();
        const maxGroupRank = groupCount > 1 ? Math.floor(teamCount / groupCount) : teamCount;
        if (advanceEnabled && (!advanceBranches.length || advanceBranches.some(branch => {
            if (!Number.isInteger(branch.start) || !Number.isInteger(branch.end) ||
                branch.start < 1 || branch.end > maxGroupRank ||
                (branch.end - branch.start + 1) * groupCount < 2) return true;
            for (let rank = branch.start; rank <= branch.end; rank += 1) {
                if (occupiedRanks.has(rank)) return true;
                occupiedRanks.add(rank);
            }
            return false;
        }))) {
            showToast(`Mỗi nhánh cần đủ ít nhất 2 đội theo thứ hạng bảng; các khoảng hạng không được trùng nhau.`);
            return;
        }

        currentLeagueId = null;
        currentShareId = null;
        readOnlyView = false;
        window.clearTimeout(autoSaveTimer);
        const previousTeams = state.teams;
        state.teams = Array.from({ length: teamCount }, (_, index) => previousTeams[index] || `Đội ${index + 1}`);
        state.teamColors = Object.fromEntries(state.teams.map(team => [
            team,
            state.teamColors[team] || '#42a34f'
        ]));
        if (competitionType === 'round-robin') state.gamesPerTeam = games;
        state.competitionType = competitionType;
        state.groupCount = competitionType === 'round-robin' ? groupCount : 1;
        state.homeAwayEnabled = homeAwayEnabled;
        state.bracketFormat = String(new FormData(setupForm).get('bracket-format') || 'single');
        state.bracketConsolation = String(formData.get('bracket-consolation') || 'none');
        state.bracketThirdPlaceEnabled = formData.has('bracket-third-place');
        state.advanceEnabled = advanceEnabled;
        state.advanceBranches = advanceEnabled
            ? advanceBranches
            : [{ start: 1, end: Math.min(4, teamCount), format: 'bracket', thirdPlace: false }];
        state.rounds = competitionType === 'bracket'
            ? Math.ceil(Math.log2(teamCount))
            : rounds;
        state.advanceFixtureSchedules = {};
        state.advanceFixtureResults = {};
        state.advanceFixtureRoundModes = {};
        createSchedule();
        setupView.classList.add('hidden');
        scheduleView.classList.remove('hidden');
        document.querySelector('.site-footer').classList.add('hidden');
    });

    document.getElementById('home-link').addEventListener('click', event => {
        event.preventDefault();
        showSetup();
    });
    document.getElementById('back-button').addEventListener('click', showSetup);
    document.getElementById('dismiss-banner').addEventListener('click', () => {
        document.getElementById('welcome-banner').classList.add('hidden');
    });
    document.getElementById('settings-button').addEventListener('click', () => {
        settingsDraft = null;
        openModal('settings');
    });
    document.getElementById('edit-schedule-button').addEventListener('click', () => {
        settingsDraft = null;
        openModal('settings');
    });
    document.getElementById('teams-button').addEventListener('click', () => openModal('teams'));
    document.getElementById('rounds-button').addEventListener('click', () => openModal('rounds'));
    document.getElementById('add-game-button').addEventListener('click', () => openModal('add-game'));
    document.getElementById('regenerate-button').addEventListener('click', () => {
        if (readOnlyView) return;
        if (hasUpdatedMatchInfo() &&
            !window.confirm('Lịch đã có thông tin trận đấu được cập nhật. Tạo lại lịch sẽ xóa các thông tin này. Bạn có muốn tiếp tục không?')) {
            return;
        }
        state.advanceFixtureSchedules = {};
        state.advanceFixtureResults = {};
        createSchedule({ reshuffleBracket: true });
        showToast('Đã tạo lại lịch thi đấu.');
    });
    document.getElementById('checker-button').addEventListener('click', checkSchedule);
    document.getElementById('standings-button').addEventListener('click', () => openModal('standings'));
    document.getElementById('copy-button').addEventListener('click', copySchedule);
    document.getElementById('print-button').addEventListener('click', () => window.print());
    document.getElementById('side-panel-toggle').addEventListener('click', () => {
        sidePanelCollapsed = !sidePanelCollapsed;
        scheduleView.classList.toggle('side-panel-collapsed', sidePanelCollapsed);
        const toggle = document.getElementById('side-panel-toggle');
        toggle.setAttribute('aria-expanded', String(!sidePanelCollapsed));
        toggle.setAttribute('aria-label', sidePanelCollapsed ? 'Mở menu' : 'Thu gọn menu');
        toggle.title = sidePanelCollapsed ? 'Mở menu' : 'Thu gọn menu';
        toggle.innerHTML = `<i class="fa-solid fa-chevron-${sidePanelCollapsed ? 'left' : 'right'}"></i>`;
        window.requestAnimationFrame(drawBracketConnectors);
    });
    window.addEventListener('resize', () => {
        if (document.querySelector('.bracket-rounds-live')) {
            window.requestAnimationFrame(() => {
                fitBracketToViewport();
                drawBracketConnectors();
            });
        }
    });
    window.addEventListener('afterprint', () => {
        document.body.classList.remove('print-standings-mode');
    });
    document.getElementById('schedule-tab-button').addEventListener('click', () => {
        matchList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('shared-standings-button').addEventListener('click', () => openModal('standings'));
    document.getElementById('share-button').addEventListener('click', shareSchedule);
    document.getElementById('save-league-button').addEventListener('click', () => {
        if (readOnlyView) return;
        openModal('save-league');
    });
    document.getElementById('my-schedules').addEventListener('click', event => {
        event.preventDefault();
        openMySchedules();
    });
    document.getElementById('account-profile-button').addEventListener('click', event => {
        event.preventDefault();
        if (currentUser) openModal('account-profile');
        else {
            authMode = 'signin';
            openModal('auth');
        }
    });
    document.getElementById('sign-out').addEventListener('click', event => {
        event.preventDefault();
        void signOutUser();
    });
    teamFilter.addEventListener('change', renderSchedule);
    matchList.addEventListener('change', event => {
        const toggle = event.target.closest('[data-advance-round-home-away]');
        if (!toggle) return;
        const key = advanceRoundModeKey(
            Number(toggle.dataset.advanceRoundBranch),
            Number(toggle.dataset.advanceRound)
        );
        const branchIndex = Number(toggle.dataset.advanceRoundBranch);
        const round = Number(toggle.dataset.advanceRound);
        if (toggle.checked) state.advanceFixtureRoundModes[key] = true;
        else delete state.advanceFixtureRoundModes[key];
        const affectedRounds = new Set([round]);
        const branch = state.advanceBranches[branchIndex];
        if (branch) {
            const finalRound = Math.ceil(Math.log2(branch.end - branch.start + 1));
            buildAdvanceFixtures()
                .filter(fixture => fixture.branchIndex === branchIndex &&
                    fixture.round > round && !(fixture.thirdPlace && round === finalRound))
                .forEach(fixture => affectedRounds.add(fixture.round));
        }
        let clearedResults = 0;
        Object.keys(state.advanceFixtureResults).forEach(code => {
            const match = /^N(\d+)-V(\d+)-M\d+$/.exec(code);
            if (!match || Number(match[1]) !== branchIndex + 1 ||
                !affectedRounds.has(Number(match[2]))) return;
            delete state.advanceFixtureResults[code];
            clearedResults += 1;
        });
        renderSchedule();
        if (clearedResults) {
            showToast('Đã xóa kết quả ở vòng này và các vòng sau do thay đổi số lượt.');
        }
    });
    matchList.addEventListener('click', event => {
        const clearAdvanceRound = event.target.closest('[data-clear-advance-branch]');
        if (clearAdvanceRound) {
            clearRandomAdvanceResults(
                Number(clearAdvanceRound.dataset.clearAdvanceBranch),
                Number(clearAdvanceRound.dataset.clearAdvanceRound)
            );
            return;
        }
        const clearBracketRound = event.target.closest('[data-clear-bracket-round]');
        if (clearBracketRound) {
            clearRandomBracketRound(Number(clearBracketRound.dataset.clearBracketRound));
            return;
        }
        const clearRound = event.target.closest('[data-clear-round]');
        if (clearRound) {
            clearRandomRound(Number(clearRound.dataset.clearRound));
            return;
        }
        const randomAdvanceRound = event.target.closest('[data-random-advance-branch]');
        if (randomAdvanceRound) {
            randomizeAdvanceRound(
                Number(randomAdvanceRound.dataset.randomAdvanceBranch),
                Number(randomAdvanceRound.dataset.randomAdvanceRound)
            );
            return;
        }
        const randomBracketRound = event.target.closest('[data-random-bracket-round]');
        if (randomBracketRound) {
            randomizeResults(Number(randomBracketRound.dataset.randomBracketRound), true);
            return;
        }
        const randomRound = event.target.closest('[data-random-round]');
        if (randomRound) {
            randomizeResults(Number(randomRound.dataset.randomRound), false);
            return;
        }
        const expandButton = event.target.closest('[data-action="toggle-bracket-expanded"]');
        if (expandButton) {
            bracketExpanded = !bracketExpanded;
            scheduleView.classList.toggle('bracket-expanded', bracketExpanded);
            document.body.classList.toggle('bracket-expanded-open', bracketExpanded);
            expandButton.setAttribute('aria-label', bracketExpanded ? 'Thu nhỏ sơ đồ' : 'Phóng to sơ đồ');
            expandButton.title = bracketExpanded ? 'Thu nhỏ sơ đồ' : 'Phóng to sơ đồ';
            expandButton.innerHTML = `<i class="fa-solid fa-${bracketExpanded ? 'compress' : 'expand'}"></i>`;
            window.requestAnimationFrame(() => {
                fitBracketToViewport();
                drawBracketConnectors();
            });
            return;
        }
        const bracketGame = event.target.closest('[data-bracket-game]');
        if (bracketGame && !readOnlyView && !bracketGame.disabled) {
            openModal('edit-bracket-match', Number(bracketGame.dataset.bracketGame));
            return;
        }
        const thirdPlaceMatch = event.target.closest('[data-third-place-match]');
        if (thirdPlaceMatch && !readOnlyView && !thirdPlaceMatch.disabled) {
            openModal('edit-third-place-match');
            return;
        }
        const advanceFixture = event.target.closest('[data-advance-fixture-code]');
        if (advanceFixture && !readOnlyView && !advanceFixture.disabled) {
            editingAdvanceFixtureCode = advanceFixture.dataset.advanceFixtureCode;
            editingAdvanceFixtureLegIndex = Number(advanceFixture.dataset.advanceLegIndex);
            openModal('advance-fixture-schedule');
            return;
        }
        const teamLink = event.target.closest('[data-team-page]');
        if (teamLink) {
            openTeamPage(teamLink.dataset.teamPage);
            return;
        }
        const button = event.target.closest('[data-round-schedule]');
        if (button) {
            openModal('round-schedule', -1, Number(button.dataset.roundSchedule));
            return;
        }
        const matchRow = event.target.closest('[data-match-index]');
        if (matchRow && !readOnlyView) openModal('edit-match', Number(matchRow.dataset.matchIndex));
    });
    teamProfile.addEventListener('click', event => {
        const teamLink = event.target.closest('[data-team-page]');
        if (teamLink) openTeamPage(teamLink.dataset.teamPage);
    });

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', event => {
        if (event.target === modalBackdrop) closeModal();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) closeModal();
    });
    modalForm.addEventListener('submit', event => { void saveModal(event); });
    modalContent.addEventListener('click', event => {
        const teamLink = event.target.closest('[data-team-page]');
        if (teamLink) {
            closeModal();
            openTeamPage(teamLink.dataset.teamPage);
            return;
        }
        if (event.target.closest('[data-action="print-standings"]')) {
            document.body.classList.add('print-standings-mode');
            window.print();
            return;
        }
        void handleModalAction(event);
    });
    modalContent.addEventListener('change', event => {
        if (event.target.name === 'sport') {
            const scoring = event.target.value === state.sport
                ? state.scoring
                : getSportPreset(event.target.value);
            const settings = modalContent.querySelector('#sport-scoring-settings');
            if (settings) settings.innerHTML = scoringSettingsFields(event.target.value, scoring);
        }
        if (/^rank-[1-4]$/.test(event.target.name)) {
            normalizeRankingPriorities(event.target);
        }
        if (event.target.name === 'home') {
            const awaySelect = modalContent.querySelector('[name="away"]');
            if (awaySelect.value === event.target.value) {
                const alternative = [...awaySelect.options].find(option => option.value !== event.target.value);
                if (alternative) awaySelect.value = alternative.value;
            }
        }
        if (event.target.name === 'round' && modalContent.querySelector('[name="use-round-schedule"]')?.checked) {
            const roundSchedule = getRoundSchedule(Number(event.target.value));
            modalContent.querySelector('[name="match-date"]').value = roundSchedule.date;
            modalContent.querySelector('[name="match-time"]').value = roundSchedule.time;
        }
        if (event.target.name === 'use-round-schedule') {
            const roundSchedule = getRoundSchedule(Number(modalContent.querySelector('[name="round"]').value));
            const dateInput = modalContent.querySelector('[name="match-date"]');
            const timeInput = modalContent.querySelector('[name="match-time"]');
            dateInput.disabled = event.target.checked;
            timeInput.disabled = event.target.checked;
            if (event.target.checked) {
                dateInput.value = roundSchedule.date;
                timeInput.value = roundSchedule.time;
            }
        }
        if (event.target.name === 'team-color-mode') {
            modalContent.querySelectorAll('.team-color-input').forEach(input => {
                input.classList.toggle('hidden', event.target.value !== 'visible');
            });
        }
        if (event.target.dataset.action === 'checker-totals') {
            checkerTotals = event.target.checked;
            modalContent.innerHTML = checkerContent();
        }
        if (['home-score', 'away-score', 'home-forfeit', 'away-forfeit', 'friendly'].includes(event.target.name)) {
            updateMatchPointsPreview();
        }
    });
    modalContent.addEventListener('input', event => {
        if (['home-score', 'away-score', 'home-forfeit', 'away-forfeit', 'friendly'].includes(event.target.name)) {
            updateMatchPointsPreview();
        }
        if (activeModal === 'settings' &&
            ['group-count', 'games', 'rounds'].includes(event.target.name)) {
            updateSettingsScheduleConstraints();
        }
    });

    function getSportPreset(sport) {
        const labels = {
            points: 'Điểm xếp hạng',
            wins: 'Số trận thắng',
            draws: 'Số trận hòa',
            losses: 'Số trận thua',
            diff: 'Hiệu số',
            scored: 'Chỉ số ghi được',
            conceded: 'Chỉ số bị ghi',
            headToHead: 'Đối đầu trực tiếp'
        };
        if (sport === 'football' || sport === 'futsal') {
            labels.diff = 'Hiệu số bàn thắng';
            labels.scored = 'Bàn thắng';
            labels.conceded = 'Bàn thua';
        } else if (sport === 'basketball') {
            labels.diff = 'Hiệu số điểm';
            labels.scored = 'Điểm ghi';
            labels.conceded = 'Điểm bị ghi';
        } else if (sport === 'volleyball' || sport === 'badminton' || sport === 'tennis') {
            labels.diff = 'Hiệu số set';
            labels.scored = 'Set thắng';
            labels.conceded = 'Set thua';
        }
        const preset = {
            win: 3,
            draw: 1,
            loss: 0,
            ranking: ['points', 'diff', 'scored', 'wins'],
            labels,
            description: 'Thắng 3 điểm, hòa 1 điểm, thua 0 điểm.'
        };
        if (sport === 'basketball') {
            return {
                ...preset,
                win: 2,
                draw: 0,
                loss: 1,
                ranking: ['points', 'wins', 'diff', 'scored'],
                description: 'Mặc định bóng rổ: thắng 2 điểm, thua 1 điểm. Tỉ số bằng nhau được xem là hòa nếu giải cho phép.'
            };
        }
        if (sport === 'volleyball') {
            return {
                ...preset,
                draw: 0,
                ranking: ['points', 'diff', 'scored', 'wins'],
                description: 'Bóng chuyền: thắng 3–0/3–1 được 3 điểm; thắng 3–2 được 2 điểm, đội thua được 1 điểm.'
            };
        }
        if (sport === 'badminton' || sport === 'tennis') {
            return {
                ...preset,
                win: 1,
                draw: 0,
                loss: 0,
                ranking: ['wins', 'diff', 'scored', 'headToHead'],
                description: 'Mặc định môn đối kháng: thắng 1 điểm xếp hạng. Nhập số ván hoặc set thắng để tính hiệu số.'
            };
        }
        if (sport === 'football' || sport === 'futsal') return preset;
        if (sport === 'esports') {
            return { ...preset, description: 'Mặc định esports: thắng 3 điểm, hòa 1 điểm, thua 0 điểm.' };
        }
        return {
            ...preset,
            description: sport
                ? 'Thiết lập điểm thắng / hòa / thua và thứ tự tiêu chí xếp hạng phù hợp với giải đấu.'
                : 'Chọn môn thể thao để tải cách tính điểm mặc định; bạn vẫn có thể tùy chỉnh các quy tắc.'
        };
    }

    function scoringSettingsFields(sport, scoring) {
        const choices = ['points', 'wins', 'diff', 'scored', 'conceded', 'headToHead', 'draws', 'losses'];
        const ranking = scoring.ranking || getSportPreset(sport).ranking;
        const labels = scoring.labels || getSportPreset(sport).labels;
        return `<div class="scoring-settings">
            <div class="scoring-heading"><strong>Cách tính điểm &amp; xếp hạng</strong><small>${getSportPreset(sport).description}</small></div>
            <div class="form-grid scoring-points">
                <label class="form-field">Điểm thắng
                    <input name="sport-win-points" type="number" min="0" max="100" step="1" value="${scoring.win}" required>
                </label>
                <label class="form-field">Điểm hòa
                    <input name="sport-draw-points" type="number" min="0" max="100" step="1" value="${scoring.draw}" required>
                </label>
                <label class="form-field">Điểm thua
                    <input name="sport-loss-points" type="number" min="0" max="100" step="1" value="${scoring.loss}" required>
                </label>
            </div>
            <div class="ranking-priorities">
                <strong>Ưu tiên xếp hạng (từ cao xuống thấp)</strong>
                ${ranking.slice(0, 4).map((criterion, index) => `<label class="ranking-priority">
                    <span>${index + 1}</span>
                    <select name="rank-${index + 1}" aria-label="Ưu tiên xếp hạng ${index + 1}">
                        ${choices.map(choice => `<option value="${choice}"${criterion === choice ? ' selected' : ''}>${escapeHtml(labels[choice])}</option>`).join('')}
                    </select>
                </label>`).join('')}
            </div>
        </div>`;
    }

    function normalizeRankingPriorities(changedSelect) {
        const selects = [...modalContent.querySelectorAll('[name^="rank-"]')];
        const order = [changedSelect, ...selects.filter(select => select !== changedSelect)];
        const used = new Set();
        order.forEach(select => {
            if (used.has(select.value)) {
                const alternative = [...select.options].find(option => !used.has(option.value));
                if (alternative) select.value = alternative.value;
            }
            used.add(select.value);
        });
    }

    function getScoreLabel() {
        if (state.sport === 'basketball') return 'Điểm số';
        if (state.sport === 'volleyball') return 'Set thắng';
        if (state.sport === 'badminton' || state.sport === 'tennis') return 'Set thắng';
        return 'Tỉ số';
    }

    function getMatchPoints(match) {
        if (match.homeForfeit && match.awayForfeit) return null;
        if (match.friendly) {
            const hasResult = match.homeForfeit || match.awayForfeit ||
                (Number.isFinite(match.homeScore) && Number.isFinite(match.awayScore));
            return hasResult ? { home: 0, away: 0, outcome: 'friendly' } : null;
        }
        if (match.homeForfeit) return { home: 0, away: state.scoring.win, outcome: 'away' };
        if (match.awayForfeit) return { home: state.scoring.win, away: 0, outcome: 'home' };
        if (!Number.isFinite(match.homeScore) || !Number.isFinite(match.awayScore)) return null;

        if (match.homeScore > match.awayScore) {
            if (state.sport === 'volleyball' && match.homeScore === 3 && match.awayScore === 2) {
                return { home: 2, away: 1, outcome: 'home' };
            }
            return { home: state.scoring.win, away: state.scoring.loss, outcome: 'home' };
        }
        if (match.awayScore > match.homeScore) {
            if (state.sport === 'volleyball' && match.awayScore === 3 && match.homeScore === 2) {
                return { home: 1, away: 2, outcome: 'away' };
            }
            return { home: state.scoring.loss, away: state.scoring.win, outcome: 'away' };
        }
        return { home: state.scoring.draw, away: state.scoring.draw, outcome: 'draw' };
    }

    function randomResultScores() {
        const homeWins = Math.random() < 0.5;
        if (state.sport === 'volleyball' || state.sport === 'badminton' || state.sport === 'tennis') {
            const winningSets = state.sport === 'volleyball' ? 3 : 2;
            const losingSets = Math.floor(Math.random() * (winningSets === 3 ? 3 : 2));
            return homeWins ? [winningSets, losingSets] : [losingSets, winningSets];
        }
        if (state.sport === 'basketball') {
            const lowerScore = 60 + Math.floor(Math.random() * 51);
            const margin = 1 + Math.floor(Math.random() * 21);
            return homeWins ? [lowerScore + margin, lowerScore] : [lowerScore, lowerScore + margin];
        }
        return [
            Math.floor(Math.random() * 6),
            Math.floor(Math.random() * 6)
        ];
    }

    function randomizeResults(round, isBracket) {
        if (readOnlyView) return;
        let generated = 0;
        if (isBracket) {
            resolveBracketProgression();
            if (round > 1 && state.bracketGames
                .filter(game => game.round === round - 1)
                .some(game => !game.winner)) {
                showToast(`Hãy hoàn thành vòng ${round - 1} trước khi tạo kết quả vòng ${round}.`);
                return;
            }
            state.bracketGames
                .filter(game => game.round === round)
                .forEach(game => {
                    if (!game.home || !game.away ||
                        Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore)) return;
                    if (state.homeAwayEnabled) {
                        if (!validBracketLegs(game.legs)) game.legs = [createEmptyBracketLeg(), createEmptyBracketLeg()];
                        game.legs.forEach(leg => {
                            if (!Number.isInteger(leg.homeScore) || !Number.isInteger(leg.awayScore)) {
                                [leg.homeScore, leg.awayScore] = randomResultScores();
                            }
                        });
                        syncBracketAggregate(game);
                    } else {
                        [game.homeScore, game.awayScore] = randomResultScores();
                    }
                    game.winnerChoice = game.homeScore === game.awayScore
                        ? (Math.random() < 0.5 ? game.home : game.away)
                        : null;
                    game.randomResult = true;
                    generated += 1;
                });
            resolveBracketProgression();
        } else {
            state.matches.filter(match => match.round === round).forEach(match => {
                if (!match.home || !match.away ||
                    Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore) ||
                    match.homeForfeit || match.awayForfeit) return;
                [match.homeScore, match.awayScore] = randomResultScores();
                match.randomResult = true;
                generated += 1;
            });
        }
        if (!generated) {
            showToast(`Vòng ${round} chưa có trận nào đủ điều kiện để tạo kết quả ngẫu nhiên.`);
            return;
        }
        renderSchedule();
        showToast(`Đã tạo kết quả ngẫu nhiên cho ${generated} trận ở vòng ${round}.`);
    }

    function clearRandomRound(round) {
        const matches = state.matches.filter(match => match.round === round && match.randomResult);
        if (!matches.length) return;
        matches.forEach(match => {
            match.homeScore = null;
            match.awayScore = null;
            delete match.randomResult;
        });
        renderSchedule();
        showToast(`Đã xóa kết quả random vòng ${round}.`);
    }

    function clearRandomBracketRound(round) {
        const games = state.bracketGames.filter(game => game.round >= round && game.randomResult);
        if (!games.length) return;
        games.forEach(game => {
            clearBracketGameResult(game);
        });
        resolveBracketProgression();
        renderSchedule();
        showToast(`Đã xóa kết quả random từ vòng ${round} trở đi.`);
    }

    function randomizeAdvanceRound(branchIndex, round) {
        if (readOnlyView || !primaryRoundRobinComplete()) {
            showToast('Hãy hoàn thành kết quả vòng tròn trước để xác định các đội vào nhánh.');
            return;
        }
        const branch = state.advanceBranches[branchIndex];
        if (!branch) return;
        const fixtures = buildAdvanceFixtures().filter(fixture =>
            fixture.branchIndex === branchIndex && fixture.round === round
        );
        if (branch.format === 'bracket' && round > 1) {
            const branchFixtures = buildAdvanceFixtures().filter(fixture =>
                fixture.branchIndex === branchIndex
            );
            const previousRound = getRequiredAdvanceRound(branch, round);
            if (branchFixtures.some(game => game.round === previousRound && !game.winner)) {
                showToast(`Hãy hoàn thành vòng ${previousRound} của nhánh ${branchIndex + 1} trước.`);
                return;
            }
        }
        let generated = 0;
        fixtures.forEach(game => {
            if (game.homeAwayEnabled) {
                const legs = game.legs.map(leg => ({ ...leg }));
                let generatedLegs = 0;
                legs.forEach(leg => {
                    if (Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore)) return;
                    [leg.homeScore, leg.awayScore] = randomResultScores();
                    generatedLegs += 1;
                });
                if (!generatedLegs) return;
                const homeScore = legs.reduce((total, leg) => total + leg.homeScore, 0);
                const awayScore = legs.reduce((total, leg) => total + leg.awayScore, 0);
                const winner = homeScore > awayScore ? game.home
                    : awayScore > homeScore ? game.away
                        : Math.random() < 0.5 ? game.home : game.away;
                state.advanceFixtureResults[game.code] = {
                    home: game.home,
                    away: game.away,
                    homeScore,
                    awayScore,
                    winner,
                    legs: legs.map(({ homeScore: legHomeScore, awayScore: legAwayScore }) => ({
                        homeScore: legHomeScore,
                        awayScore: legAwayScore
                    })),
                    randomResult: true
                };
                generated += generatedLegs;
                return;
            }
            if (!(Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore))) {
                const [homeScore, awayScore] = randomResultScores();
                const winner = homeScore > awayScore ? game.home
                    : awayScore > homeScore ? game.away
                        : Math.random() < 0.5 ? game.home : game.away;
                state.advanceFixtureResults[game.code] = {
                    home: game.home,
                    away: game.away,
                    homeScore,
                    awayScore,
                    winner: branch.format === 'bracket' ? winner : null,
                    randomResult: true
                };
                generated += 1;
            }
        });
        if (!generated) {
            showToast(`Nhánh ${branchIndex + 1} vòng ${round} không còn trận nào cần tạo kết quả.`);
            return;
        }
        renderSchedule();
        showToast(`Đã tạo kết quả ngẫu nhiên cho ${generated} trận ở nhánh ${branchIndex + 1}, vòng ${round}.`);
    }

    function clearRandomAdvanceResults(branchIndex, round) {
        const branch = state.advanceBranches[branchIndex];
        if (!branch) return;
        const clearedRounds = new Set([round]);
        if (branch.format === 'bracket') {
            const finalRound = Math.ceil(Math.log2(branch.end - branch.start + 1));
            buildAdvanceFixtures()
                .filter(fixture => fixture.branchIndex === branchIndex &&
                    fixture.round > round && !(fixture.thirdPlace && round === finalRound))
                .forEach(fixture => clearedRounds.add(fixture.round));
        }
        let cleared = 0;
        Object.entries(state.advanceFixtureResults).forEach(([code, result]) => {
            const match = /^N(\d+)-V(\d+)-M\d+$/.exec(code);
            if (!match || Number(match[1]) !== branchIndex + 1 ||
                !clearedRounds.has(Number(match[2])) || !result.randomResult) return;
            delete state.advanceFixtureResults[code];
            cleared += 1;
        });
        if (!cleared) return;
        renderSchedule();
        showToast(`Đã xóa ${cleared} kết quả random ở nhánh ${branchIndex + 1}, từ vòng ${round}${branch.format === 'bracket' ? ' trở đi' : ''}.`);
    }

    function updateMatchPointsPreview() {
        if (!['add-game', 'edit-match'].includes(activeModal)) return;
        const formData = new FormData(modalForm);
        const homeScoreValue = String(formData.get('home-score') || '');
        const awayScoreValue = String(formData.get('away-score') || '');
        const match = {
            homeScore: homeScoreValue === '' ? null : Number(homeScoreValue),
            awayScore: awayScoreValue === '' ? null : Number(awayScoreValue),
            homeForfeit: formData.has('home-forfeit'),
            awayForfeit: formData.has('away-forfeit'),
            friendly: formData.has('friendly')
        };
        const points = getMatchPoints(match);
        const homePointsInput = modalContent.querySelector('[name="home-points-preview"]');
        const awayPointsInput = modalContent.querySelector('[name="away-points-preview"]');
        homePointsInput.value = points ? points.home : '';
        awayPointsInput.value = points ? points.away : '';
    }

    function showSetup() {
        bracketExpanded = false;
        document.body.classList.remove('bracket-expanded-open');
        scheduleView.classList.remove('bracket-expanded');
        readOnlyView = false;
        scheduleView.classList.remove('read-only-view');
        updateAccountNavigation();
        setupForm.querySelector(`[name="competition-type"][value="${state.competitionType}"]`).checked = true;
        setupForm.querySelector(`[name="bracket-format"][value="${state.bracketFormat}"]`).checked = true;
        setupForm.querySelector(`[name="bracket-consolation"][value="${state.bracketConsolation}"]`).checked = true;
        setupForm.querySelector('[name="bracket-third-place"]').checked = state.bracketThirdPlaceEnabled;
        document.getElementById('advance-enabled').checked = state.advanceEnabled;
        teamCountInput.value = state.teams.length;
        groupCountInput.value = state.groupCount;
        renderAdvanceBranches();
        setupForm.querySelector('[name="home-away-enabled"]').checked = state.homeAwayEnabled;
        gamesInput.value = state.gamesPerTeam;
        weeksInput.value = state.rounds;
        updateBracketSetup();
        scheduleView.classList.add('hidden');
        setupView.classList.remove('hidden');
        document.querySelector('.site-footer').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function createSchedule({ reshuffleBracket = false } = {}) {
        state.advanceFixtureResults = {};
        if (state.competitionType === 'bracket') {
            state.rounds = Math.ceil(Math.log2(state.teams.length));
            state.thirdPlaceGame = createEmptyBracketGame();
            state.bracketGames = reshuffleBracket
                ? buildRegeneratedBracketGames(state.teams, state.bracketGames)
                : buildBracketGames(state.teams);
            resolveBracketProgression();
        } else {
            state.bracketGames = [];
            state.thirdPlaceGame = null;
        }
        Object.keys(state.roundSchedules).forEach(round => {
            if (Number(round) > state.rounds) delete state.roundSchedules[round];
        });
        state.matches = state.competitionType === 'bracket'
            ? []
            : buildSchedule(state.teams, state.gamesPerTeam, state.rounds);
        populateFilter();
        renderSchedule();
    }

    function buildRegeneratedBracketGames(teams, currentGames) {
        const currentFirstRound = currentGames
            .filter(game => game.round === 1)
            .sort((a, b) => a.position - b.position);
        const hasDifferentDraw = games => {
            const firstRound = games.filter(game => game.round === 1).sort((a, b) => a.position - b.position);
            return firstRound.some((game, index) =>
                game.home !== currentFirstRound[index]?.home || game.away !== currentFirstRound[index]?.away);
        };

        for (let attempt = 0; attempt < 50; attempt += 1) {
            const games = buildBracketGames(shuffle(teams));
            if (hasDifferentDraw(games)) return games;
        }

        for (let offset = 1; offset < teams.length; offset += 1) {
            const rotatedTeams = teams.slice(offset).concat(teams.slice(0, offset));
            const games = buildBracketGames(rotatedTeams);
            if (hasDifferentDraw(games)) return games;
        }

        return buildBracketGames(teams);
    }

    function hasUpdatedMatchInfo() {
        const hasMatchDetails = match => Boolean(
            match.date || match.time || match.comment ||
            Number.isFinite(match.homeScore) || Number.isFinite(match.awayScore) ||
            match.homeForfeit || match.awayForfeit || match.friendly ||
            Array.isArray(match.legs) && match.legs.some(leg =>
                leg.date || leg.time || Number.isFinite(leg.homeScore) || Number.isFinite(leg.awayScore))
        );
        return state.competitionType === 'bracket'
            ? state.bracketGames.some(hasMatchDetails) || hasMatchDetails(state.thirdPlaceGame || {})
            : state.matches.some(hasMatchDetails) ||
                Object.keys(state.advanceFixtureSchedules).length > 0 ||
                Object.keys(state.advanceFixtureResults).length > 0;
    }

    function validBracketGames(games, teams, homeAwayEnabled = false) {
        const scoreLimit = homeAwayEnabled ? 1998 : 999;
        const maxRounds = Math.ceil(Math.log2(teams.length));
        const size = 2 ** maxRounds;
        const maxGames = size - 1;
        const expectedPositions = new Set(Array.from({ length: maxGames }, (_, index) => {
            let round = 1;
            let position = index;
            while (position >= size / (2 ** round)) {
                position -= size / (2 ** round);
                round += 1;
            }
            return `${round}:${position}`;
        }));
        return Array.isArray(games) && games.length === maxGames &&
            games.every(game => game && Number.isInteger(game.round) && game.round >= 1 &&
                game.round <= maxRounds && Number.isInteger(game.position) && game.position >= 0 &&
                expectedPositions.delete(`${game.round}:${game.position}`) &&
                (game.home === null || teams.includes(game.home)) &&
                (game.away === null || teams.includes(game.away)) &&
                (game.homeScore === null || Number.isInteger(game.homeScore) && game.homeScore >= 0 && game.homeScore <= scoreLimit) &&
                (game.awayScore === null || Number.isInteger(game.awayScore) && game.awayScore >= 0 && game.awayScore <= scoreLimit) &&
                (!homeAwayEnabled || validBracketLegs(game.legs)) &&
                (game.winnerChoice === null || teams.includes(game.winnerChoice))) && expectedPositions.size === 0;
    }

    function validThirdPlaceGame(game, teams, homeAwayEnabled = false) {
        const scoreLimit = homeAwayEnabled ? 1998 : 999;
        return Boolean(game && typeof game === 'object' && !Array.isArray(game) &&
            (game.home === null || teams.includes(game.home)) &&
            (game.away === null || teams.includes(game.away)) &&
            (game.homeScore === null || Number.isInteger(game.homeScore) && game.homeScore >= 0 && game.homeScore <= scoreLimit) &&
            (game.awayScore === null || Number.isInteger(game.awayScore) && game.awayScore >= 0 && game.awayScore <= scoreLimit) &&
            (game.winnerChoice === null || game.winnerChoice === game.home || game.winnerChoice === game.away) &&
            (!homeAwayEnabled || validBracketLegs(game.legs)) &&
            typeof game.date === 'string' && typeof game.time === 'string' &&
            validDateTime(game.date, game.time) && typeof game.comment === 'string');
    }

    function validBracketLegs(legs) {
        return Array.isArray(legs) && legs.length === 2 && legs.every(leg =>
            leg && typeof leg === 'object' &&
            (leg.homeScore === null || Number.isInteger(leg.homeScore) && leg.homeScore >= 0 && leg.homeScore <= 999) &&
            (leg.awayScore === null || Number.isInteger(leg.awayScore) && leg.awayScore >= 0 && leg.awayScore <= 999) &&
            (leg.homeScore === null) === (leg.awayScore === null) &&
            typeof leg.date === 'string' && typeof leg.time === 'string' &&
            validDateTime(leg.date, leg.time));
    }

    function createEmptyBracketLeg() {
        return { homeScore: null, awayScore: null, date: '', time: '' };
    }

    function clearBracketGameResult(game) {
        game.homeScore = null;
        game.awayScore = null;
        game.winnerChoice = null;
        if (Array.isArray(game.legs)) {
            game.legs.forEach(leg => {
                leg.homeScore = null;
                leg.awayScore = null;
            });
        }
        delete game.randomResult;
    }

    function syncBracketAggregate(game) {
        if (!state.homeAwayEnabled) return;
        if (!validBracketLegs(game.legs)) game.legs = [createEmptyBracketLeg(), createEmptyBracketLeg()];
        const complete = game.legs.every(leg => Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore));
        game.homeScore = complete ? game.legs.reduce((total, leg) => total + leg.homeScore, 0) : null;
        game.awayScore = complete ? game.legs.reduce((total, leg) => total + leg.awayScore, 0) : null;
    }

    function createEmptyBracketGame() {
        return {
            home: null,
            away: null,
            homeScore: null,
            awayScore: null,
            winnerChoice: null,
            winner: null,
            date: '',
            time: '',
            comment: '',
            legs: [createEmptyBracketLeg(), createEmptyBracketLeg()]
        };
    }

    function buildBracketGames(teams) {
        const size = 2 ** Math.ceil(Math.log2(Math.max(2, teams.length)));
        const seeds = bracketSeedOrder(size);
        const slots = seeds.map(seed => seed <= teams.length ? teams[seed - 1] : null);
        const games = [];
        for (let round = 1; round <= Math.log2(size); round += 1) {
            const count = size / (2 ** round);
            for (let position = 0; position < count; position += 1) {
                games.push({
                    round,
                    position,
                    home: round === 1 ? slots[position * 2] : null,
                    away: round === 1 ? slots[position * 2 + 1] : null,
                    homeScore: null,
                    awayScore: null,
                    winnerChoice: null,
                    winner: null,
                    date: '',
                    time: '',
                    comment: '',
                    legs: [createEmptyBracketLeg(), createEmptyBracketLeg()]
                });
            }
        }
        return games;
    }

    function resolveBracketProgression() {
        const rounds = Math.ceil(Math.log2(state.teams.length));
        const gamesByRound = Array.from({ length: rounds }, (_, index) =>
            state.bracketGames.filter(game => game.round === index + 1).sort((a, b) => a.position - b.position));

        gamesByRound.forEach((games, roundIndex) => {
            if (roundIndex > 0) {
                games.forEach(game => {
                    const home = gamesByRound[roundIndex - 1][game.position * 2]?.winner || null;
                    const away = gamesByRound[roundIndex - 1][game.position * 2 + 1]?.winner || null;
                    if (game.home !== home || game.away !== away) {
                        clearBracketGameResult(game);
                    }
                    game.home = home;
                    game.away = away;
                });
            }
            games.forEach(game => {
                if (game.home && game.away) syncBracketAggregate(game);
                game.winner = null;
                if (roundIndex === 0 && game.home && !game.away) {
                    game.winner = game.home;
                } else if (roundIndex === 0 && game.away && !game.home) {
                    game.winner = game.away;
                } else if (game.home && game.away &&
                    Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore)) {
                    if (game.homeScore > game.awayScore) game.winner = game.home;
                    else if (game.awayScore > game.homeScore) game.winner = game.away;
                    else if (game.winnerChoice === game.home || game.winnerChoice === game.away) {
                        game.winner = game.winnerChoice;
                    }
                }
            });
        });
        const thirdPlaceEnabled = state.bracketThirdPlaceEnabled && state.teams.length >= 4;
        if (!thirdPlaceEnabled) {
            state.thirdPlaceGame = createEmptyBracketGame();
            return;
        }
        const semifinalRound = rounds - 1;
        const semifinalLosers = state.bracketGames
            .filter(game => game.round === semifinalRound && game.home && game.away && game.winner)
            .map(game => game.winner === game.home ? game.away : game.home);
        const game = state.thirdPlaceGame || (state.thirdPlaceGame = createEmptyBracketGame());
        const home = semifinalLosers.length === 2 ? semifinalLosers[0] : null;
        const away = semifinalLosers.length === 2 ? semifinalLosers[1] : null;
        if (game.home !== home || game.away !== away) {
            clearBracketGameResult(game);
        }
        game.home = home;
        game.away = away;
        if (home && away) syncBracketAggregate(game);
        game.winner = null;
        if (home && away && Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore)) {
            if (game.homeScore > game.awayScore) game.winner = home;
            else if (game.awayScore > game.homeScore) game.winner = away;
            else if (game.winnerChoice === home || game.winnerChoice === away) game.winner = game.winnerChoice;
        }
    }

    function buildSchedule(teams, gamesPerTeam, rounds) {
        return splitTeamsIntoGroups(teams, state.groupCount).flatMap((group, groupIndex) => {
            const matches = state.homeAwayEnabled
                ? buildDoubleRoundSchedule(group, gamesPerTeam, rounds)
                : buildSingleLegSchedule(group, gamesPerTeam, rounds);
            return matches.map(match => ({ ...match, group: groupIndex + 1 }));
        });
    }

    function getGroupSizes(teamCount, groupCount = state.groupCount) {
        if (!Number.isInteger(teamCount) || teamCount < 1 ||
            !Number.isInteger(groupCount) || groupCount < 1) return [];
        const baseSize = Math.floor(teamCount / groupCount);
        const largerGroupCount = teamCount % groupCount;
        return Array.from({ length: groupCount }, (_, index) =>
            baseSize + Number(index < largerGroupCount));
    }

    function splitTeamsIntoGroups(teams = state.teams, groupCount = state.groupCount) {
        const sizes = getGroupSizes(teams.length, groupCount);
        let offset = 0;
        return sizes.map(size => {
            const group = teams.slice(offset, offset + size);
            offset += size;
            return group;
        });
    }

    function normalizeAdvanceBranches(teamCount, groupCount) {
        const maxRank = Math.floor(teamCount / groupCount);
        const minRankSpan = groupCount > 1 ? 1 : 2;
        const branches = [];
        state.advanceBranches.forEach(branch => {
            const start = Math.max(branch.start, branches.length ? branches[branches.length - 1].end + 1 : 1);
            if (start + minRankSpan - 1 > maxRank) return;
            const end = Math.min(Math.max(branch.end, start + minRankSpan - 1), maxRank);
            branches.push({
                ...branch,
                start,
                end,
                thirdPlace: branch.thirdPlace && branch.format === 'bracket' &&
                    (end - start + 1) * groupCount >= 4
            });
        });
        return branches.length
            ? branches
            : [{
                start: 1,
                end: Math.min(groupCount > 1 ? 2 : 4, maxRank),
                format: 'bracket',
                thirdPlace: false
            }];
    }

    function groupLabel(groupIndex) {
        return groupIndex < 26
            ? `Bảng ${String.fromCharCode(65 + groupIndex)}`
            : `Bảng ${groupIndex + 1}`;
    }

    function buildDoubleRoundSchedule(teams, gamesPerTeam, rounds) {
        const opponentsPerTeam = gamesPerTeam / 2;
        const firstLegMatchCount = teams.length * opponentsPerTeam / 2;
        const legRounds = Math.floor(rounds / 2);
        for (let attempt = 0; attempt < 200; attempt += 1) {
            const firstLeg = buildSingleLegSchedule(teams, opponentsPerTeam, legRounds);
            const appearances = new Map(teams.map(team => [team, 0]));
            const pairs = new Set();
            firstLeg.forEach(match => {
                appearances.set(match.home, appearances.get(match.home) + 1);
                appearances.set(match.away, appearances.get(match.away) + 1);
                pairs.add(pairKey(match.home, match.away));
            });
            if (firstLeg.length !== firstLegMatchCount ||
                [...appearances.values()].some(count => count !== opponentsPerTeam) ||
                pairs.size !== firstLeg.length) continue;
            const returnLeg = firstLeg.map(match => ({
                round: match.round + legRounds,
                home: match.away,
                away: match.home
            }));
            return firstLeg.concat(returnLeg);
        }
        throw new Error('Không thể tạo lịch lượt đi lượt về với số trận và số vòng đã chọn.');
    }

    function buildSingleLegSchedule(teams, gamesPerTeam, rounds) {
        const matches = [];
        const appearances = new Map(teams.map(team => [team, 0]));
        const meetingsByPair = new Map();
        const firstLegsByPair = new Map();
        const byeCounts = new Map(teams.map(team => [team, 0]));
        const totalMatches = Math.floor(teams.length * gamesPerTeam / 2);
        let remainingMatches = totalMatches;

        for (let round = 1; round <= rounds && remainingMatches > 0; round += 1) {
            const roundsLeft = rounds - round + 1;
            const target = Math.min(Math.floor(teams.length / 2), Math.ceil(remainingMatches / roundsLeft));
            const byeCount = teams.length - target * 2;
            const byeTeams = shuffle([...teams])
                .sort((a, b) => byeCounts.get(a) - byeCounts.get(b) || appearances.get(b) - appearances.get(a))
                .slice(0, byeCount);
            byeTeams.forEach(team => byeCounts.set(team, byeCounts.get(team) + 1));
            const activeTeams = teams.filter(team => !byeTeams.includes(team));
            const roundMatches = findRoundMatches(
                activeTeams, gamesPerTeam, appearances, meetingsByPair, firstLegsByPair, target, false
            );
            roundMatches.forEach(([home, away]) => {
                matches.push({ round, home, away });
                appearances.set(home, appearances.get(home) + 1);
                appearances.set(away, appearances.get(away) + 1);
                const key = pairKey(home, away);
                meetingsByPair.set(key, (meetingsByPair.get(key) || 0) + 1);
                if (!firstLegsByPair.has(key)) firstLegsByPair.set(key, { home, away });
            });
            remainingMatches -= roundMatches.length;
        }
        return matches;
    }

    function findRoundMatches(teams, gamesPerTeam, appearances, meetingsByPair, firstLegsByPair, target, homeAwayEnabled) {
        let bestMatches = [];
        for (let attempt = 0; attempt < 120; attempt += 1) {
            const candidates = shuffle([...teams]);
            const used = new Set();
            const matches = [];

            while (matches.length < target) {
                const available = candidates
                    .filter(team => !used.has(team) && appearances.get(team) < gamesPerTeam)
                    .sort((a, b) => appearances.get(a) - appearances.get(b));
                if (available.length < 2) break;

                const home = available[0];
                const opponents = available
                    .slice(1)
                    .filter(team => (meetingsByPair.get(pairKey(home, team)) || 0) < (homeAwayEnabled ? 2 : 1))
                    .sort((a, b) => appearances.get(a) - appearances.get(b));
                if (!opponents.length) {
                    used.add(home);
                    continue;
                }

                const opponentPool = opponents.filter(team => appearances.get(team) === appearances.get(opponents[0]));
                const away = opponentPool[Math.floor(Math.random() * opponentPool.length)];
                const firstLeg = firstLegsByPair.get(pairKey(home, away));
                matches.push(firstLeg ? [firstLeg.away, firstLeg.home] : [home, away]);
                used.add(home);
                used.add(away);
            }

            if (matches.length > bestMatches.length) bestMatches = matches;
            if (matches.length === target) return matches;
        }
        return bestMatches;
    }

    function shuffle(items) {
        const shuffled = [...items];
        for (let index = shuffled.length - 1; index > 0; index -= 1) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
        }
        return shuffled;
    }

    function pairKey(first, second) {
        return [first, second].sort((a, b) => a.localeCompare(b)).join('\u0000');
    }

    function maxGamesPerTeam(teamCount, rounds, homeAwayEnabled, groupCount = 1) {
        const sizes = getGroupSizes(teamCount, groupCount);
        if (!sizes.length) return 0;
        return Math.min(...sizes.map(size => {
            if (!homeAwayEnabled) return Math.min(rounds, size - 1);
            const perRoundCapacity = Math.floor(size / 2);
            for (let games = Math.min(rounds, (size - 1) * 2); games >= 2; games -= 1) {
                if (games % 2 !== 0) continue;
                const firstLegGamesPerTeam = games / 2;
                if (size * firstLegGamesPerTeam % 2 !== 0) continue;
                const firstLegRounds = Math.ceil(
                    size * firstLegGamesPerTeam / 2 / perRoundCapacity
                );
                if (firstLegRounds * 2 <= rounds) return games;
            }
            return 0;
        }));
    }

    function minimumRoundsForGames(teamCount, gamesPerTeam, homeAwayEnabled, groupCount = 1) {
        const sizes = getGroupSizes(teamCount, groupCount);
        if (!sizes.length) return 50;
        if (!homeAwayEnabled) return gamesPerTeam;
        const opponentsPerTeam = gamesPerTeam / 2;
        if (!Number.isInteger(opponentsPerTeam) || opponentsPerTeam < 1) return 50;
        const groupRounds = sizes.map(size => {
            if (size * opponentsPerTeam % 2 !== 0) return 50;
            const matchesPerRound = Math.floor(size / 2);
            const legRounds = Math.ceil(size * opponentsPerTeam / 2 / matchesPerRound);
            return legRounds * 2;
        });
        return Math.max(...groupRounds);
    }

    function populateFilter() {
        const selected = teamFilter.value;
        teamFilter.innerHTML = '<option value="">Tất cả các đội</option>' +
            state.teams.map(team => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`).join('');
        if (state.teams.includes(selected)) teamFilter.value = selected;
    }

    // Trả về tên vòng đấu loại trực tiếp đúng ngữ nghĩa
    // round: vòng hiện tại (1-indexed), totalRounds: tổng số vòng (không tính tranh hạng ba)
    function getBracketRoundName(round, totalRounds) {
        const remaining = totalRounds - round; // số vòng còn lại sau vòng này
        if (remaining === 0) return 'Chung kết';
        if (remaining === 1) return 'Bán kết';
        if (remaining === 2) return 'Tứ kết';
        return `Vòng ${round}`;
    }

    function renderSchedule() {
        if (activeTeamName && !state.teams.includes(activeTeamName)) activeTeamName = '';
        scheduleView.classList.toggle('team-page-active', Boolean(activeTeamName));
        scheduleView.classList.toggle('read-only-view', readOnlyView);
        scheduleView.classList.toggle('bracket-active', state.competitionType === 'bracket');
        scheduleView.classList.toggle('side-panel-collapsed', sidePanelCollapsed);
        scheduleView.classList.toggle('bracket-expanded', bracketExpanded && state.competitionType === 'bracket');
        document.body.classList.toggle('bracket-expanded-open',
            bracketExpanded && state.competitionType === 'bracket');
        updateAccountNavigation();
        document.getElementById('league-title').textContent = state.league;
        document.getElementById('season-title').textContent = state.season;
        const draftBadge = document.getElementById('draft-badge');
        if (draftBadge) draftBadge.classList.toggle('hidden', !state.draft);
        document.getElementById('readonly-badge').classList.toggle('hidden', !readOnlyView);
        document.getElementById('shared-standings-button').classList.toggle('hidden', !readOnlyView);
        const teamProfile = document.getElementById('team-profile');
        teamProfile.classList.toggle('hidden', !activeTeamName);
        if (activeTeamName) renderTeamProfile(activeTeamName);
        if (state.competitionType === 'bracket' && !activeTeamName) {
            matchList.innerHTML = interactiveBracketMarkup();
            window.requestAnimationFrame(() => {
                fitBracketToViewport();
                drawBracketConnectors();
            });
            if (currentUser && currentLeagueId && !readOnlyView && !savingLeague) scheduleAutoSave();
            return;
        }
        const filter = teamFilter.value;
        const rounds = Array.from({ length: state.rounds }, (_, index) => index + 1);
        const advanceFixtures = state.advanceEnabled ? buildAdvanceFixtures() : [];

        const roundRobinSections = rounds.map(round => {
            const roundMatches = state.matches
                .map((match, index) => ({ ...match, index }))
                .filter(match => match.round === round &&
                    (!filter || match.home === filter || match.away === filter));
            const opponents = new Set();
            roundMatches.forEach(match => {
                opponents.add(match.home);
                opponents.add(match.away);
            });
            const byes = filter
                ? (state.teams.includes(filter) && !opponents.has(filter) ? [filter] : [])
                : state.teams.filter(team => !opponents.has(team));
            const games = roundMatches.length
                ? roundMatches.map(match => {
                    const result = getMatchPoints(match);
                    const schedule = getMatchSchedule(match);
                    const score = result
                        ? (match.homeForfeit ? 'Bỏ cuộc' : (Number.isFinite(match.homeScore) ? match.homeScore : '0')) +
                            ' – ' +
                            (match.awayForfeit ? 'Bỏ cuộc' : (Number.isFinite(match.awayScore) ? match.awayScore : '0'))
                        : 'v';
                    return `
                    <div class="match-row" data-match-index="${match.index}">
                        ${state.groupCount > 1 ? `<span class="match-group-badge">${groupLabel(match.group - 1)}</span>` : ''}
                        <button class="team-home match-team-link" type="button" data-team-page="${escapeHtml(match.home)}" aria-label="Xem thông tin ${escapeHtml(match.home)}">${teamLabel(match.home, 'home')}</button>
                        <span class="${result ? 'match-score' : 'versus'}">${score}</span>
                        <button class="team-away match-team-link" type="button" data-team-page="${escapeHtml(match.away)}" aria-label="Xem thông tin ${escapeHtml(match.away)}">${teamLabel(match.away, 'away')}</button>
                        <button class="edit-match" type="button" aria-label="Chỉnh sửa trận ${escapeHtml(match.home)} và ${escapeHtml(match.away)}"><i class="fa-solid fa-pen-to-square"></i></button>
                        ${schedule.date || schedule.time ? `<span class="match-datetime"><i class="fa-regular fa-clock"></i> ${escapeHtml(formatMatchDateTime(schedule.date, schedule.time))}</span>` : ''}
                    </div>`;
                }).join('')
                : '<p class="empty-round">Chưa có trận đấu được lên lịch.</p>';
            const byeRows = byes.length
                ? `<div class="bye-row"><i class="fa-regular fa-moon"></i><strong>Đội nghỉ:</strong> ${byes.map(team => escapeHtml(team)).join(' · ')}</div>`
                : '';
            const roundSchedule = getRoundSchedule(round);
            const hasRoundSchedule = Boolean(roundSchedule.date || roundSchedule.time);
            const roundDateTime = hasRoundSchedule
                ? formatMatchDateTime(roundSchedule.date, roundSchedule.time)
                : 'Thêm ngày giờ';
            const randomResults = state.matches.filter(match =>
                match.round === round && match.randomResult
            ).length;
            const pendingResults = state.matches.filter(match =>
                match.round === round &&
                !(Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore)) &&
                !match.homeForfeit && !match.awayForfeit
            ).length;
            return `<section class="round-section">
                <div class="round-heading">
                    <h2>Vòng ${round}</h2>
                    <div class="round-heading-actions">
                        ${readOnlyView
                            ? (hasRoundSchedule
                                ? `<span class="round-schedule-public"><i class="fa-regular fa-calendar-days"></i> ${escapeHtml(roundDateTime)}</span>`
                                : '')
                            : `<button class="round-schedule-button" type="button" data-round-schedule="${round}" aria-label="Cài ngày giờ vòng ${round}">
                                <i class="fa-regular fa-calendar-days"></i> ${escapeHtml(roundDateTime)}
                            </button>
                            <button class="random-round-button" type="button" data-random-round="${round}"
                                ${pendingResults ? '' : 'disabled'}
                                aria-label="Tạo kết quả ngẫu nhiên vòng ${round}">
                                <i class="fa-solid fa-dice"></i><span>Random</span>
                            </button>
                            <button class="clear-random-button" type="button" data-clear-round="${round}"
                                ${randomResults && !readOnlyView ? '' : 'disabled'}
                                aria-label="Xóa kết quả random vòng ${round}">
                                <i class="fa-solid fa-eraser"></i><span>Clear</span>
                            </button>`}
                        <span>${roundMatches.length} trận</span>
                    </div>
                </div>
                ${games}${byeRows}
            </section>`;
        }).join('');
        matchList.innerHTML = `${state.advanceEnabled
            ? `<div class="tournament-match-summary">
                <strong>Tổng lịch: ${state.matches.length + advanceFixtureMatchCount(advanceFixtures)} trận</strong>
                    <span>Vòng tròn: ${state.matches.length} trận · Vòng tiếp theo: ${advanceFixtureMatchCount(advanceFixtures)} trận</span>
                ${state.homeAwayEnabled ? '<span>Vòng tròn thi đấu lượt đi, lượt về; các cặp đổi sân ở lượt về.</span>' : ''}
                <span>Đội ở vòng tiếp theo đang hiển thị theo thứ hạng dự kiến.</span>
            </div>`
            : ''}${roundRobinSections}${state.advanceEnabled ? advanceFixturesMarkup(advanceFixtures) : ''}`;

        if (currentUser && currentLeagueId && !readOnlyView && !savingLeague) scheduleAutoSave();
    }

    function advanceRoundModeKey(branchIndex, round) {
        return `N${branchIndex + 1}-V${round}`;
    }

    function isAdvanceRoundHomeAway(branchIndex, round) {
        return state.advanceFixtureRoundModes[advanceRoundModeKey(branchIndex, round)] === true;
    }

    function advanceFixtureLegCode(code, legIndex) {
        return `${code}-L${legIndex + 1}`;
    }

    function validAdvanceScorePair(homeScore, awayScore, maximum) {
        const validScore = score => score === null ||
            Number.isInteger(score) && score >= 0 && score <= maximum;
        return validScore(homeScore) && validScore(awayScore) &&
            (homeScore === null) === (awayScore === null);
    }

    function validAdvanceFixtureLegs(legs) {
        return Array.isArray(legs) && legs.length === 2 &&
            legs.every(leg => leg && typeof leg === 'object' &&
                validAdvanceScorePair(leg.homeScore, leg.awayScore, 999));
    }

    function emptyAdvanceFixtureLeg() {
        return { homeScore: null, awayScore: null };
    }

    function advanceFixtureSchedule(code, legIndex = -1) {
        const schedule = legIndex >= 0
            ? state.advanceFixtureSchedules[advanceFixtureLegCode(code, legIndex)] ||
                (legIndex === 0 ? state.advanceFixtureSchedules[code] : null)
            : state.advanceFixtureSchedules[code];
        return schedule || { date: '', time: '' };
    }

    function buildAdvanceBracketFixture(branchIndex, round, position, code, home, away, extra = {}) {
        const savedResult = state.advanceFixtureResults[code];
        const sameTeams = savedResult && savedResult.home === home && savedResult.away === away;
        const homeAwayEnabled = isAdvanceRoundHomeAway(branchIndex, round);
        const legs = homeAwayEnabled
            ? sameTeams && validAdvanceFixtureLegs(savedResult.legs)
                ? savedResult.legs.map(leg => ({ ...leg }))
                : sameTeams && Number.isInteger(savedResult.homeScore) && Number.isInteger(savedResult.awayScore)
                    ? [{ homeScore: savedResult.homeScore, awayScore: savedResult.awayScore }, emptyAdvanceFixtureLeg()]
                    : [emptyAdvanceFixtureLeg(), emptyAdvanceFixtureLeg()]
            : [];
        const complete = homeAwayEnabled && legs.every(leg =>
            Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore));
        const homeScore = homeAwayEnabled
            ? complete ? legs.reduce((total, leg) => total + leg.homeScore, 0) : null
            : sameTeams ? savedResult.homeScore : null;
        const awayScore = homeAwayEnabled
            ? complete ? legs.reduce((total, leg) => total + leg.awayScore, 0) : null
            : sameTeams ? savedResult.awayScore : null;
        const winner = sameTeams && Number.isInteger(homeScore) && Number.isInteger(awayScore)
            ? homeScore > awayScore ? home
                : awayScore > homeScore ? away
                    : [home, away].includes(savedResult.winner) ? savedResult.winner : null
            : null;
        const schedule = advanceFixtureSchedule(code);
        if (homeAwayEnabled) {
            legs.forEach((leg, index) => {
                Object.assign(leg, advanceFixtureSchedule(code, index));
            });
        }
        return {
            branchIndex,
            format: 'bracket',
            round,
            position,
            code,
            home,
            away,
            date: homeAwayEnabled ? legs[0].date : schedule.date,
            time: homeAwayEnabled ? legs[0].time : schedule.time,
            homeScore,
            awayScore,
            winner,
            homeAwayEnabled,
            legs,
            ...extra
        };
    }

    function advanceFixtureLegRows(fixture) {
        if (!fixture.homeAwayEnabled) {
            return [{ ...fixture, legIndex: -1, displayCode: fixture.code }];
        }
        return fixture.legs.map((leg, legIndex) => {
            const returnLeg = legIndex === 1;
            const schedule = advanceFixtureSchedule(fixture.code, legIndex);
            return {
                ...fixture,
                legIndex,
                displayCode: `${fixture.code} · ${returnLeg ? 'Lượt về' : 'Lượt đi'}`,
                home: returnLeg ? fixture.away : fixture.home,
                away: returnLeg ? fixture.home : fixture.away,
                homeScore: returnLeg ? leg.awayScore : leg.homeScore,
                awayScore: returnLeg ? leg.homeScore : leg.awayScore,
                date: schedule.date,
                time: schedule.time,
                position: fixture.position * 2 + legIndex
            };
        });
    }

    function advanceFixtureMatchCount(fixtures) {
        return fixtures.reduce((count, fixture) =>
            count + (fixture.homeAwayEnabled ? 2 : 1), 0);
    }

    function buildAdvanceFixtures() {
        const fixtures = [];
        const qualificationReady = primaryRoundRobinComplete();
        const groupStandings = splitTeamsIntoGroups().map((teams, groupIndex) => ({
            teams,
            groupIndex,
            sortedStandings: sortedLeagueStandings(
                state.matches.filter(match => teams.includes(match.home) && teams.includes(match.away)),
                teams
            ).sortedStandings
        }));
        state.advanceBranches.forEach((branch, branchIndex) => {
            const participants = groupStandings.flatMap(group =>
                Array.from({ length: branch.end - branch.start + 1 }, (_, index) => {
                    const rank = branch.start + index;
                    return qualificationReady
                        ? group.sortedStandings[rank - 1]?.team
                        : state.groupCount > 1
                            ? `${groupLabel(group.groupIndex)} · Hạng ${rank}`
                            : `Hạng ${rank}`;
                })
            ).filter(Boolean);
            if (branch.format === 'round-robin') {
                const ring = [...participants];
                if (ring.length % 2) ring.push(null);
                for (let round = 0; round < ring.length - 1; round += 1) {
                    for (let position = 0; position < ring.length / 2; position += 1) {
                        const home = ring[position];
                        const away = ring[ring.length - 1 - position];
                        if (home && away) {
                            const code = `N${branchIndex + 1}-V${round + 1}-M${String(position + 1).padStart(2, '0')}`;
                            const result = state.advanceFixtureResults[code];
                            fixtures.push({
                                branchIndex,
                                format: branch.format,
                                round: round + 1,
                                position,
                                code,
                                home,
                                away,
                                homeScore: result && result.home === home && result.away === away ? result.homeScore : null,
                                awayScore: result && result.home === home && result.away === away ? result.awayScore : null
                            });
                        }
                    }
                    ring.splice(1, 0, ring.pop());
                }
                return;
            }

            const size = 2 ** Math.ceil(Math.log2(participants.length));
            let slots = bracketSeedOrder(size).map(seed => participants[seed - 1] || null);
            const rounds = Math.log2(size);
            for (let round = 1; round <= rounds; round += 1) {
                const nextSlots = [];
                for (let position = 0; position < slots.length / 2; position += 1) {
                    const home = slots[position * 2];
                    const away = slots[position * 2 + 1];
                    const code = `N${branchIndex + 1}-V${round}-M${String(position + 1).padStart(2, '0')}`;
                    if (home && away) {
                        const fixture = buildAdvanceBracketFixture(
                            branchIndex, round, position, code, home, away
                        );
                        fixtures.push(fixture);
                        nextSlots.push(fixture.winner || `Thắng ${code}`);
                    } else {
                        nextSlots.push(home || away);
                    }
                }
                slots = nextSlots;
            }
            if (branch.thirdPlace) {
                const semifinals = fixtures
                    .filter(fixture => fixture.branchIndex === branchIndex && fixture.round === rounds - 1)
                    .sort((first, second) => first.position - second.position);
                if (semifinals.length === 2) {
                    const home = semifinals[0].winner
                        ? (semifinals[0].winner === semifinals[0].home ? semifinals[0].away : semifinals[0].home)
                        : `Thua ${semifinals[0].code}`;
                    const away = semifinals[1].winner
                        ? (semifinals[1].winner === semifinals[1].home ? semifinals[1].away : semifinals[1].home)
                        : `Thua ${semifinals[1].code}`;
                    const round = rounds + 1;
                    const position = 0;
                    const code = `N${branchIndex + 1}-V${round}-M01`;
                    fixtures.push(buildAdvanceBracketFixture(
                        branchIndex, round, position, code, home, away, { thirdPlace: true }
                    ));
                }
            }
        });
        return fixtures;
    }

    function getRequiredAdvanceRound(branch, round) {
        const finalRound = Math.ceil(Math.log2(branch.end - branch.start + 1));
        return branch.thirdPlace && round === finalRound + 1 ? finalRound - 1 : round - 1;
    }

    function advanceFixturesMarkup(fixtures) {
        const sections = [];
        state.advanceBranches.forEach((branch, branchIndex) => {
            const branchFixtures = fixtures.filter(fixture => fixture.branchIndex === branchIndex);
            const roundGroups = new Map();
            branchFixtures.forEach(fixture => {
                if (!roundGroups.has(fixture.round)) roundGroups.set(fixture.round, []);
                roundGroups.get(fixture.round).push(fixture);
            });
            roundGroups.forEach((games, round) => {
                const matchRows = games.flatMap(advanceFixtureLegRows).sort(compareAdvanceFixtures);
                const pendingGames = games.filter(game =>
                    !(Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore))).length;
                const previousRound = branch.format === 'bracket'
                    ? getRequiredAdvanceRound(branch, round)
                    : round - 1;
                const previousRoundComplete = branch.format !== 'bracket' || round === 1 ||
                    branchFixtures.filter(game => game.round === previousRound).every(game => game.winner);
                const canRandomize = primaryRoundRobinComplete() && pendingGames > 0 && previousRoundComplete;
                const randomGames = games.filter(game => {
                    const result = state.advanceFixtureResults[game.code];
                    return result && result.randomResult;
                }).length;
                const formatTitle = branch.format === 'bracket' ? 'Loại trực tiếp' : 'Vòng tròn';
                const roundHomeAway = isAdvanceRoundHomeAway(branchIndex, round);
                sections.push(`<section class="round-section advance-round-section">
                    <div class="round-heading">
                        <h2>Nhánh ${branchIndex + 1} · ${formatTitle} · ${games.some(game => game.thirdPlace)
                            ? 'Tranh hạng ba'
                            : branch.format === 'bracket'
                                ? getBracketRoundName(round, Math.ceil(Math.log2(branch.end - branch.start + 1)))
                                : `Vòng ${round}`}</h2>
                        <div class="round-heading-actions">
                            ${branch.format === 'bracket' && !readOnlyView && games.length
                                ? `<label class="advance-round-home-away">
                                    <input type="checkbox" data-advance-round-home-away
                                        data-advance-round-branch="${branchIndex}" data-advance-round="${round}"
                                        ${roundHomeAway ? 'checked' : ''}>
                                    <span>Lượt đi, lượt về</span>
                                </label>`
                                : ''}
                            ${readOnlyView ? '' : `<button class="random-round-button" type="button"
                                data-random-advance-branch="${branchIndex}" data-random-advance-round="${round}"
                                ${canRandomize ? '' : 'disabled'}
                                aria-label="Tạo kết quả ngẫu nhiên nhánh ${branchIndex + 1} vòng ${round}">
                                <i class="fa-solid fa-dice"></i><span>Random</span>
                            </button>`}
                            ${readOnlyView ? '' : `<button class="clear-random-button" type="button"
                                data-clear-advance-branch="${branchIndex}" data-clear-advance-round="${round}"
                                ${randomGames ? '' : 'disabled'}
                                aria-label="Xóa kết quả random nhánh ${branchIndex + 1} vòng ${round}">
                                <i class="fa-solid fa-eraser"></i><span>Clear</span>
                            </button>`}
                            <span>${matchRows.length} trận</span>
                        </div>
                    </div>
                    ${matchRows.map(game => advanceFixtureRow(game)).join('')}
                </section>`);
            });
        });
        return sections.join('');
    }

    function compareAdvanceFixtures(first, second) {
        const firstTimestamp = first.date && first.time ? Date.parse(`${first.date}T${first.time}`) : Infinity;
        const secondTimestamp = second.date && second.time ? Date.parse(`${second.date}T${second.time}`) : Infinity;
        return firstTimestamp - secondTimestamp ||
            first.round - second.round ||
            first.position - second.position;
    }

    function advanceFixtureRow(game) {
        const title = game.thirdPlace ? 'Tranh hạng ba' : game.format === 'bracket'
            ? getBracketRoundName(game.round, Math.ceil(Math.log2(
                state.advanceBranches[game.branchIndex].end - state.advanceBranches[game.branchIndex].start + 1
            )))
            : `Vòng ${game.round}`;
        const schedule = formatMatchDateTime(game.date, game.time);
        const isEditable = game.format === 'bracket' && !readOnlyView;
        const hasResult = Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore);
        const rowCode = game.displayCode || game.code;
        const ariaLabel = `${rowCode}, ${title}: ${game.home} ${hasResult ? `${game.homeScore} – ${game.awayScore}` : 'gặp'} ${game.away}${schedule ? `, ${schedule}` : ', chưa có ngày giờ'}`;
        return `<button class="match-row advance-fixture-row" type="button"
                data-advance-fixture-code="${game.code}" data-advance-leg-index="${game.legIndex}"${isEditable ? '' : ' disabled'}
                aria-label="${escapeHtml(ariaLabel)}">
            <span class="advance-fixture-meta">
                <span class="advance-fixture-code">${escapeHtml(rowCode)}</span>
                <span class="advance-fixture-round">${title}</span>
            </span>
            <span class="advance-fixture-pair">
                <span class="advance-fixture-team">${escapeHtml(game.home)}</span>
                <span class="${hasResult ? 'match-score' : 'versus'}">${hasResult ? `${game.homeScore} – ${game.awayScore}` : 'v'}</span>
                <span class="advance-fixture-team">${escapeHtml(game.away)}</span>
            </span>
            ${schedule || !readOnlyView
                ? `<span class="advance-fixture-date${schedule ? '' : ' advance-fixture-date-empty'}"><i class="fa-regular fa-clock"></i> ${escapeHtml(schedule || 'Thêm ngày giờ')}</span>`
                : ''}
        </button>`;
    }

    function teamLabel(team, side) {
        if (state.teamColorMode === 'hidden') return escapeHtml(team);
        const color = state.teamColorMode === 'home-away'
            ? (side === 'home' ? '#3d8bce' : '#e39345')
            : safeTeamColor(state.teamColors[team]);
        return `<span class="team-chip" style="--team-color:${color}">${escapeHtml(team)}</span>`;
    }

    function openTeamPage(team) {
        if (!state.teams.includes(team)) {
            showToast('Không tìm thấy đội trong giải đấu hiện tại.');
            return;
        }
        activeTeamName = team;
        renderSchedule();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function closeTeamPage() {
        activeTeamName = '';
        renderSchedule();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function teamPageLink(team, label = team, className = '') {
        return `<button type="button" class="team-page-link ${className}" data-team-page="${escapeHtml(team)}">${escapeHtml(label)}</button>`;
    }

    function renderTeamProfile(team) {
        const profile = document.getElementById('team-profile');
        const playedMatches = state.matches.filter(match =>
            !match.friendly && (match.home === team || match.away === team) && getMatchPoints(match));
        const stats = { played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, points: 0 };
        playedMatches.forEach(match => {
            const homeSide = match.home === team;
            const result = getMatchPoints(match);
            stats.played += 1;
            stats.scored += Number.isFinite(homeSide ? match.homeScore : match.awayScore) ? (homeSide ? match.homeScore : match.awayScore) : 0;
            stats.conceded += Number.isFinite(homeSide ? match.awayScore : match.homeScore) ? (homeSide ? match.awayScore : match.homeScore) : 0;
            stats.points += homeSide ? result.home : result.away;
            if ((homeSide && result.outcome === 'home') || (!homeSide && result.outcome === 'away')) stats.wins += 1;
            else if (result.outcome === 'draw') stats.draws += 1;
            else if (result.outcome !== 'friendly') stats.losses += 1;
        });
        const advanceTeamMatches = state.advanceEnabled
            ? buildAdvanceFixtures()
                .flatMap(advanceFixtureLegRows)
                .filter(match => match.home === team || match.away === team)
            : [];
        advanceTeamMatches.forEach(match => {
            if (!Number.isInteger(match.homeScore) || !Number.isInteger(match.awayScore)) return;
            const homeSide = match.home === team;
            const teamScore = homeSide ? match.homeScore : match.awayScore;
            const opponentScore = homeSide ? match.awayScore : match.homeScore;
            stats.played += 1;
            stats.scored += teamScore;
            stats.conceded += opponentScore;
            if (teamScore > opponentScore) stats.wins += 1;
            else if (teamScore < opponentScore) stats.losses += 1;
            else stats.draws += 1;
        });

        const teamGroup = splitTeamsIntoGroups().find(teams => teams.includes(team)) || state.teams;
        const teamGroupNames = new Set(teamGroup);
        const completedForRanking = state.matches.filter(match =>
            !match.friendly && teamGroupNames.has(match.home) && teamGroupNames.has(match.away) &&
            getMatchPoints(match));
        const rankingStats = new Map(teamGroup.map(name => [name, {
            team: name, played: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, points: 0
        }]));
        completedForRanking.forEach(match => {
            const home = rankingStats.get(match.home);
            const away = rankingStats.get(match.away);
            if (!home || !away) return;
            const result = getMatchPoints(match);
            const homeScore = Number.isFinite(match.homeScore) ? match.homeScore : 0;
            const awayScore = Number.isFinite(match.awayScore) ? match.awayScore : 0;
            home.played += 1; away.played += 1;
            home.scored += homeScore; home.conceded += awayScore;
            away.scored += awayScore; away.conceded += homeScore;
            home.points += result.home; away.points += result.away;
            if (result.outcome === 'home') { home.wins += 1; away.losses += 1; }
            else if (result.outcome === 'away') { away.wins += 1; home.losses += 1; }
            else if (result.outcome === 'draw') { home.draws += 1; away.draws += 1; }
            home.diff = home.scored - home.conceded;
            away.diff = away.scored - away.conceded;
        });
        const ranking = rankStandings([...rankingStats.values()], completedForRanking, state.scoring.ranking || ['points', 'diff', 'scored', 'wins']);
        const position = ranking.findIndex(item => item.team === team) + 1;
        const positionLabel = state.groupCount > 1
            ? `${groupLabel(splitTeamsIntoGroups().findIndex(teams => teams.includes(team)))} · Hạng ${position || '—'}`
            : `Hạng ${position || '—'}`;
        const scoreLabel = state.sport === 'volleyball' || state.sport === 'badminton' || state.sport === 'tennis'
            ? 'Set'
            : state.sport === 'basketball' ? 'Điểm' : 'Bàn thắng';
        const roundsPlayed = new Set(state.matches.filter(match => match.home === team || match.away === team).map(match => match.round));
        const byeRounds = Array.from({ length: state.rounds }, (_, index) => index + 1).filter(round => !roundsPlayed.has(round));
        const teamMatches = state.matches
            .filter(match => match.home === team || match.away === team)
            .map(match => ({
                ...match,
                phaseOrder: 0,
                phase: '',
                position: match.index || 0,
                schedule: getMatchSchedule(match),
                complete: Boolean(getMatchPoints(match))
            }));
        if (state.competitionType === 'bracket') {
            const roundCount = Math.ceil(Math.log2(state.teams.length));
            state.bracketGames
                .filter(game => game.home && game.away && (game.home === team || game.away === team))
                .forEach(game => teamMatches.push({
                    ...game,
                    phaseOrder: 1,
                    phase: 'Loại trực tiếp',
                    title: getBracketRoundName(game.round, roundCount),
                    position: game.position,
                    schedule: { date: game.date || '', time: game.time || '' },
                    complete: Boolean(game.winner)
                }));
        }
        if (state.advanceEnabled) {
            advanceTeamMatches.forEach(fixture => {
                    const branch = state.advanceBranches[fixture.branchIndex];
                    teamMatches.push({
                        ...fixture,
                        phaseOrder: fixture.branchIndex + 2,
                        phase: `Nhánh ${fixture.branchIndex + 1} · ${branch.format === 'bracket' ? 'Loại trực tiếp' : 'Vòng tròn'}`,
                        title: `${fixture.thirdPlace
                            ? 'Tranh hạng ba'
                            : branch.format === 'bracket'
                            ? getBracketRoundName(fixture.round, Math.ceil(Math.log2(branch.end - branch.start + 1)))
                            : `Vòng ${fixture.round}`}${fixture.homeAwayEnabled
                                ? ` · ${fixture.legIndex === 0 ? 'Lượt đi' : 'Lượt về'}`
                                : ''}`,
                        schedule: {
                            date: fixture.date || '',
                            time: fixture.time || ''
                        },
                        complete: Number.isInteger(fixture.homeScore) &&
                            Number.isInteger(fixture.awayScore)
                    });
                });
        }
        teamMatches.sort((first, second) =>
            first.phaseOrder - second.phaseOrder ||
            first.round - second.round ||
            first.position - second.position
        );
        const color = safeTeamColor(state.teamColors[team]);
        const matchHistory = teamMatches.length
            ? teamMatches.map(match => {
                const homeSide = match.home === team;
                const opponent = homeSide ? match.away : match.home;
                const isScored = Number.isInteger(match.homeScore) && Number.isInteger(match.awayScore);
                const score = isScored
                    ? `${match.homeForfeit ? 'Bỏ cuộc' : match.homeScore} – ${match.awayForfeit ? 'Bỏ cuộc' : match.awayScore}`
                    : 'Chưa thi đấu';
                const schedule = match.schedule || { date: '', time: '' };
                const status = match.friendly ? '<span class="team-match-badge friendly">Giao hữu</span>'
                    : match.complete ? '<span class="team-match-badge completed">Đã đấu</span>'
                        : '<span class="team-match-badge upcoming">Sắp diễn ra</span>';
                return `<article class="team-match-card">
                    <div class="team-match-round">
                        <strong>${escapeHtml(match.phase ? `${match.phase} · ${match.title}` : `Vòng ${match.round}`)}</strong>
                        <span>${escapeHtml(formatMatchDateTime(schedule.date, schedule.time) || 'Chưa có ngày giờ')}</span>
                    </div>
                    <div class="team-match-versus">
                        <span>${homeSide ? `<strong>${escapeHtml(team)}</strong>` : teamPageLink(opponent, opponent)}</span>
                        <b>${escapeHtml(score)}</b>
                        <span>${homeSide ? teamPageLink(opponent, opponent) : `<strong>${escapeHtml(team)}</strong>`}</span>
                    </div>
                    <div class="team-match-status">${status}<span>${homeSide ? 'Sân nhà' : 'Sân khách'}</span></div>
                    ${match.comment ? `<p class="team-match-comment">${escapeHtml(match.comment)}</p>` : ''}
                </article>`;
            }).join('')
            : `<p class="team-profile-empty">${state.competitionType === 'bracket'
                ? 'Đây là bản xem trước nhánh; kết quả và lịch sử trận chưa được ghi nhận.'
                : 'Đội chưa có trận đấu nào trong lịch.'}</p>`;

        profile.innerHTML = `<button type="button" class="button button-outline team-back-button" data-action="back-to-schedule"><i class="fa-solid fa-arrow-left"></i> Trở lại lịch đấu</button>
            <header class="team-profile-heading">
                <span class="team-profile-mark" style="--team-color:${color}"><i class="fa-solid fa-shield-halved"></i></span>
                <div><span class="eyebrow">${escapeHtml(state.league)} · ${escapeHtml(state.season)}</span><h2>${escapeHtml(team)}</h2><p>${escapeHtml(getSportName(state.sport))} · ${state.competitionType === 'bracket' ? 'Đấu cúp · Chưa xếp hạng' : positionLabel}</p></div>
            </header>
            <div class="team-stat-grid">
                <div><strong>${stats.played}</strong><span>Đã đấu</span></div>
                <div><strong>${stats.wins}</strong><span>Thắng</span></div>
                <div><strong>${stats.draws}</strong><span>Hòa</span></div>
                <div><strong>${stats.losses}</strong><span>Thua</span></div>
                <div><strong>${stats.scored}:${stats.conceded}</strong><span>${escapeHtml(scoreLabel)} ghi : thua</span></div>
                <div><strong>${stats.points}</strong><span>Điểm</span></div>
            </div>
            ${state.competitionType !== 'bracket' && byeRounds.length ? `<p class="team-bye-rounds"><i class="fa-regular fa-moon"></i> Nghỉ ở vòng: ${byeRounds.join(', ')}</p>` : ''}
            <div class="team-profile-section-heading"><h3>Lịch thi đấu</h3><span>${teamMatches.length} trận</span></div>
            <div class="team-match-list">${matchHistory}</div>`;
        profile.querySelector('[data-action="back-to-schedule"]').addEventListener('click', closeTeamPage);
    }

    function getRoundSchedule(round) {
        return state.roundSchedules[round] || { date: '', time: '' };
    }

    function getMatchSchedule(match) {
        if (match.scheduleOverride) {
            return { date: match.date || '', time: match.time || '' };
        }
        return getRoundSchedule(match.round);
    }

    function formatMatchDateTime(date, time) {
        if (date && time) return `${formatDate(date)} · ${time}`;
        if (date) return formatDate(date);
        if (time) return time;
        return '';
    }

    function formatDate(date) {
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : date;
    }

    function openModal(kind, matchIndex = -1, round = -1) {
        activeModal = kind;
        editingMatchIndex = matchIndex;
        editingRound = round;
        modalContent.innerHTML = modalFields(kind, matchIndex);
        if (kind === 'settings') updateSettingsScheduleConstraints();
        modalTitle.textContent = ({
            settings: 'Cài đặt giải đấu',
            teams: 'Quản lý các đội',
            rounds: 'Thiết lập số vòng',
            'add-game': 'Thêm trận đấu',
            'edit-match': 'Chỉnh sửa trận đấu',
            'edit-bracket-match': 'Chỉnh sửa trận đấu',
            'edit-third-place-match': 'Chỉnh sửa trận tranh hạng ba',
            'advance-fixture-schedule': 'Ngày giờ trận loại trực tiếp',
            checker: 'Kiểm tra lịch thi đấu',
            standings: 'Bảng xếp hạng',
            'round-schedule': `Lịch vòng ${round}`,
            auth: authMode === 'signup' ? 'Tạo tài khoản MLeague' : 'Đăng nhập MLeague',
            'account-profile': 'Thông tin tài khoản',
            'my-schedules': 'Các giải đấu đã lưu',
            'save-league': currentLeagueId ? 'Cập nhật giải đấu đã lưu' : 'Lưu giải đấu',
            'share-link': 'Chia sẻ giải đấu'
        })[kind];
        const saveButton = modalForm.querySelector('.modal-footer .button-primary');
        const cancelButton = document.getElementById('modal-cancel');
        const readOnlyModal = ['checker', 'standings', 'my-schedules', 'share-link'].includes(kind);
        saveButton.classList.toggle('hidden', readOnlyModal);
        saveButton.textContent = kind === 'auth'
            ? (authMode === 'signup' ? 'Tạo tài khoản' : 'Đăng nhập')
            : kind === 'save-league' ? 'Lưu giải đấu'
                : 'Lưu thay đổi';
        cancelButton.textContent = readOnlyModal ? 'Đóng' : 'Hủy';
        modalForm.classList.toggle('checker-modal', kind === 'checker');
        const modal = modalBackdrop.querySelector('.modal');
        modal.classList.toggle('checker-wide', kind === 'checker' || kind === 'standings');
        modal.classList.toggle('match-editor', kind === 'edit-match' || kind === 'add-game' ||
            kind === 'edit-bracket-match' || kind === 'edit-third-place-match' ||
            kind === 'advance-fixture-schedule');
        modalBackdrop.classList.remove('hidden');
        const firstInput = modalContent.querySelector('input, textarea, select');
        if (firstInput) firstInput.focus();
    }

    function modalFields(kind, matchIndex) {
        const match = kind === 'edit-match' ? state.matches[matchIndex] : null;
        const bracketMatch = kind === 'edit-bracket-match'
            ? state.bracketGames[matchIndex]
            : kind === 'edit-third-place-match' ? state.thirdPlaceGame : null;
        const teamOptions = (selectedTeam = '') => state.teams.map(team =>
            `<option value="${escapeHtml(team)}"${team === selectedTeam ? ' selected' : ''}>${escapeHtml(team)}</option>`).join('');
        const roundOptions = Array.from({ length: state.rounds }, (_, index) =>
            `<option value="${index + 1}"${match && match.round === index + 1 ? ' selected' : ''}>Vòng ${index + 1}</option>`).join('');

        if ((kind === 'edit-bracket-match' || kind === 'edit-third-place-match') && bracketMatch) {
            const winnerOptions = [bracketMatch.home, bracketMatch.away].filter(Boolean).map(team =>
                `<option value="${escapeHtml(team)}"${bracketMatch.winnerChoice === team ? ' selected' : ''}>${escapeHtml(team)}</option>`
            ).join('');
            const legFields = state.homeAwayEnabled
                ? (bracketMatch.legs || [createEmptyBracketLeg(), createEmptyBracketLeg()]).map((leg, index) => `
                    <fieldset class="bracket-leg-fields">
                        <legend>${index === 0 ? 'Lượt đi' : 'Lượt về · đổi sân'}</legend>
                        <label class="form-field">${getScoreLabel()} — ${escapeHtml(bracketMatch.home)}
                            <input name="leg-${index}-home-score" type="number" min="0" max="999" step="1" value="${Number.isInteger(leg.homeScore) ? leg.homeScore : ''}" placeholder="Chưa có kết quả">
                        </label>
                        <label class="form-field">${getScoreLabel()} — ${escapeHtml(bracketMatch.away)}
                            <input name="leg-${index}-away-score" type="number" min="0" max="999" step="1" value="${Number.isInteger(leg.awayScore) ? leg.awayScore : ''}" placeholder="Chưa có kết quả">
                        </label>
                        <label class="form-field">Ngày thi đấu
                            <input name="leg-${index}-date" type="date" value="${escapeHtml(leg.date || '')}">
                        </label>
                        <label class="form-field">Giờ bắt đầu
                            <input name="leg-${index}-time" type="time" value="${escapeHtml(leg.time || '')}">
                        </label>
                    </fieldset>`).join('')
                : `<label class="form-field">${getScoreLabel()} — ${escapeHtml(bracketMatch.home)}
                        <input name="home-score" type="number" min="0" max="999" step="1" value="${Number.isInteger(bracketMatch.homeScore) ? bracketMatch.homeScore : ''}" placeholder="Chưa có kết quả">
                    </label>
                    <label class="form-field">${getScoreLabel()} — ${escapeHtml(bracketMatch.away)}
                        <input name="away-score" type="number" min="0" max="999" step="1" value="${Number.isInteger(bracketMatch.awayScore) ? bracketMatch.awayScore : ''}" placeholder="Chưa có kết quả">
                    </label>
                    <label class="form-field">Ngày thi đấu
                        <input name="match-date" type="date" value="${escapeHtml(bracketMatch.date || '')}">
                    </label>
                    <label class="form-field">Giờ bắt đầu
                        <input name="match-time" type="time" value="${escapeHtml(bracketMatch.time || '')}">
                    </label>`;
            return `<div class="bracket-match-editor">
                <p class="bracket-match-editor-teams"><strong>${escapeHtml(bracketMatch.home)}</strong><span>vs</span><strong>${escapeHtml(bracketMatch.away)}</strong></p>
                <div class="match-edit-grid">
                    ${legFields}
                    <label class="form-field bracket-tiebreak-field">Đội thắng nếu tỉ số hòa
                        <select name="bracket-winner">
                            <option value="">Chọn khi cần phân định</option>
                            ${winnerOptions}
                        </select>
                    </label>
                    <label class="form-field match-comment">Ghi chú
                        <textarea name="comment" rows="3" maxlength="500" placeholder="Ghi chú cho trận đấu">${escapeHtml(bracketMatch.comment || '')}</textarea>
                    </label>
                </div>
                <p class="match-scoring-note"><i class="fa-solid fa-circle-info"></i> ${state.homeAwayEnabled
                    ? 'Nhập đủ tỉ số cho cả hai lượt; đội thắng được xác định theo tổng tỉ số. Nếu tổng hòa, chọn đội thắng để đi tiếp.'
                    : 'Nhập đủ hai tỷ số. Nếu hòa, chọn đội thắng để đi tiếp.'}</p>
            </div>`;
        }
        if (kind === 'teams') {
            const rows = state.teams.map((team, index) => `
                <div class="team-edit-row">
                    <span class="team-edit-number">${index + 1}</span>
                    <input class="team-name-input" name="team-name" value="${escapeHtml(team)}" maxlength="60" aria-label="Tên đội ${index + 1}">
                    <input class="team-color-input${state.teamColorMode === 'visible' ? '' : ' hidden'}" name="team-color" type="color" value="${safeTeamColor(state.teamColors[team])}" aria-label="Màu đội ${index + 1}">
                    <button class="team-remove-button" type="button" data-action="remove-team" aria-label="Xóa ${escapeHtml(team)}"><i class="fa-solid fa-trash-can"></i></button>
                </div>`).join('');
            return `<div class="team-manager">
                <div class="team-edit-list">${rows}</div>
                <button class="button button-outline add-team-button" type="button" data-action="add-team"><i class="fa-solid fa-plus"></i> Thêm đội</button>
                <button class="bulk-toggle" type="button" data-action="toggle-bulk">Thêm đội hàng loạt <i class="fa-solid fa-caret-right"></i></button>
                <label class="form-field bulk-team-field hidden">Danh sách thêm nhanh
                    <small>Mỗi dòng một đội. Tên mới sẽ được thêm vào danh sách hiện tại.</small>
                    <textarea name="bulk-teams" placeholder="Đội mới 1&#10;Đội mới 2"></textarea>
                </label>
                <div class="team-color-settings">
                    <strong>Màu đội</strong>
                    <div class="radio-row">
                        <label><input type="radio" name="team-color-mode" value="hidden"${state.teamColorMode === 'hidden' ? ' checked' : ''}> Ẩn</label>
                        <label><input type="radio" name="team-color-mode" value="visible"${state.teamColorMode === 'visible' ? ' checked' : ''}> Hiện</label>
                        <label><input type="radio" name="team-color-mode" value="home-away"${state.teamColorMode === 'home-away' ? ' checked' : ''}> Nhà / khách</label>
                    </div>
                </div>
                <p class="team-limit-note"><i class="fa-solid fa-circle-info"></i> Từ 2 đến 50 đội. Tên đội phải khác nhau.</p>
            </div>`;
        }
        if (kind === 'rounds') {
            return `<label class="form-field">Số tuần / vòng
                <small>Số vòng cần đủ để xếp hết các trận; tối đa 50.</small>
                <input name="rounds" type="number" min="${minimumRoundsForGames(state.teams.length, state.gamesPerTeam, state.homeAwayEnabled, state.groupCount)}" max="50" value="${state.rounds}" required>
            </label>`;
        }
        if (kind === 'auth') {
            return `<div class="account-form">
                <p>${authMode === 'signup' ? 'Tạo tài khoản để lưu và quản lý các giải đấu của bạn.' : 'Đăng nhập để mở các giải đấu đã lưu.'}</p>
                <label class="form-field">Email
                    <input name="account-email" type="email" autocomplete="email" required maxlength="254" placeholder="ten@email.com">
                </label>
                <label class="form-field">Mật khẩu
                    <input name="account-password" type="password" autocomplete="${authMode === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required>
                </label>
                <button class="button button-text auth-mode-toggle" type="button" data-action="toggle-auth-mode">${authMode === 'signup' ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Tạo tài khoản'}</button>
            </div>`;
        }
        if (kind === 'account-profile' && currentUser) {
            const createdAt = currentUser.metadata && currentUser.metadata.creationTime
                ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(currentUser.metadata.creationTime))
                : 'Không có thông tin';
            return `<div class="account-profile">
                <div class="account-profile-summary">
                    <span class="account-avatar"><i class="fa-solid fa-user"></i></span>
                    <div><strong>${escapeHtml(currentUser.displayName || currentUser.email || 'Tài khoản MLeague')}</strong>
                        <small>Tài khoản MLeague</small></div>
                </div>
                <label class="form-field">Tên tài khoản
                    <input name="account-display-name" type="text" maxlength="80"
                        value="${escapeHtml(currentUser.displayName || '')}" placeholder="Nhập tên hiển thị">
                    <small>Tên này sẽ hiển thị trên thanh điều hướng.</small>
                </label>
                <label class="form-field">Email
                    <input type="email" value="${escapeHtml(currentUser.email || '')}" disabled>
                </label>
                <div class="account-profile-detail"><span>Ngày tạo</span><strong>${escapeHtml(createdAt)}</strong></div>
                <button class="button button-outline account-profile-signout" type="button" data-action="account-sign-out">
                    <i class="fa-solid fa-arrow-right-from-bracket"></i> Đăng xuất tài khoản
                </button>
            </div>`;
        }
        if (kind === 'save-league') {
            return `<label class="form-field">Tên giải đấu
                <input name="saved-league-title" type="text" maxlength="100" required value="${escapeHtml(state.league)}" placeholder="Tên giải">
                <small>Giải đấu được lưu riêng trong tài khoản của bạn.</small>
            </label>`;
        }
        if (kind === 'my-schedules') {
            return `<div class="saved-leagues" aria-live="polite"><p class="saved-leagues-loading">Đang tải danh sách giải đấu…</p></div>`;
        }
        if (kind === 'share-link') {
            const url = new URL(window.location.href);
            url.search = '';
            url.searchParams.set('share', currentShareId);
            return `<div class="share-link-content">
                <p>Ai có liên kết đều có thể xem lịch; chỉ tài khoản của bạn mới chỉnh sửa được.</p>
                <label class="form-field">Liên kết chỉ xem
                    <input name="share-url" type="url" readonly value="${escapeHtml(url.toString())}">
                </label>
                <button class="button button-outline" type="button" data-action="copy-active-share"><i class="fa-regular fa-copy"></i> Sao chép liên kết</button>
            </div>`;
        }
        if (kind === 'checker') return checkerContent();
        if (kind === 'standings') return standingsContent();
        if (kind === 'round-schedule') {
            const schedule = getRoundSchedule(editingRound);
            return `<div class="round-schedule-form">
                <p class="round-schedule-help">Ngày giờ mặc định cho các trận thuộc vòng này. Trận đã đặt lịch riêng sẽ không bị thay đổi.</p>
                <label class="form-field">Ngày thi đấu
                    <input name="round-date" type="date" value="${escapeHtml(schedule.date)}">
                </label>
                <label class="form-field">Giờ bắt đầu
                    <input name="round-time" type="time" value="${escapeHtml(schedule.time)}">
                </label>
                <button class="button button-text clear-round-schedule" type="button" data-action="clear-round-schedule">Xóa ngày giờ vòng này</button>
            </div>`;
        }
        if (kind === 'advance-fixture-schedule') {
            const fixture = buildAdvanceFixtures().find(game => game.code === editingAdvanceFixtureCode);
            if (!fixture || fixture.format !== 'bracket') return '';
            const legIndex = editingAdvanceFixtureLegIndex;
            const returnLeg = legIndex === 1;
            const legHome = returnLeg ? fixture.away : fixture.home;
            const legAway = returnLeg ? fixture.home : fixture.away;
            const schedule = advanceFixtureSchedule(fixture.code, legIndex);
            const legTitle = legIndex >= 0 ? ` · ${returnLeg ? 'Lượt về' : 'Lượt đi'}` : '';
            return `<div class="round-schedule-form">
                <p class="round-schedule-help"><strong>${escapeHtml(fixture.code)}${legTitle}</strong> · ${escapeHtml(legHome)} vs ${escapeHtml(legAway)}. Lịch được sắp xếp theo ngày giờ đã đặt.</p>
                <label class="form-field">Ngày thi đấu
                    <input name="advance-date" type="date" value="${escapeHtml(schedule.date || '')}">
                </label>
                <label class="form-field">Giờ bắt đầu
                    <input name="advance-time" type="time" value="${escapeHtml(schedule.time || '')}">
                </label>
                <small class="round-schedule-help">Để trống cả hai trường rồi lưu để xóa lịch trận này.</small>
            </div>`;
        }
        if (kind === 'add-game' || kind === 'edit-match') {
            const scoreLabel = getScoreLabel();
            const homeScore = match && Number.isFinite(match.homeScore) ? match.homeScore : '';
            const awayScore = match && Number.isFinite(match.awayScore) ? match.awayScore : '';
            const homeForfeit = Boolean(match && match.homeForfeit);
            const awayForfeit = Boolean(match && match.awayForfeit);
            const friendly = Boolean(match && match.friendly);
            const initialPoints = getMatchPoints(match || {});
            const matchSchedule = match ? getMatchSchedule(match) : getRoundSchedule(1);
            const useRoundSchedule = !match || !match.scheduleOverride;
            return `<div class="match-edit-grid">
                <label class="form-field">Đội nhà
                    <select name="home" required>${teamOptions(match ? match.home : '')}</select>
                </label>
                <label class="form-field">Đội khách
                    <select name="away" required>${teamOptions(match ? match.away : '')}</select>
                </label>
                <label class="form-field">${scoreLabel} — đội nhà
                    <input name="home-score" type="number" min="0" max="999" step="1" value="${homeScore}" placeholder="Chưa có kết quả">
                </label>
                <label class="form-field">${scoreLabel} — đội khách
                    <input name="away-score" type="number" min="0" max="999" step="1" value="${awayScore}" placeholder="Chưa có kết quả">
                </label>
                <label class="match-option"><span>Đội nhà bỏ cuộc</span><input name="home-forfeit" type="checkbox"${homeForfeit ? ' checked' : ''}></label>
                <label class="match-option"><span>Đội khách bỏ cuộc</span><input name="away-forfeit" type="checkbox"${awayForfeit ? ' checked' : ''}></label>
                <label class="form-field">Điểm xếp hạng — đội nhà
                    <input name="home-points-preview" type="number" value="${initialPoints ? initialPoints.home : ''}" placeholder="Tự tính sau khi nhập kết quả" readonly>
                </label>
                <label class="form-field">Điểm xếp hạng — đội khách
                    <input name="away-points-preview" type="number" value="${initialPoints ? initialPoints.away : ''}" placeholder="Tự tính sau khi nhập kết quả" readonly>
                </label>
                <label class="form-field">Vòng
                    <select name="round" required>${roundOptions}</select>
                </label>
                <div class="match-date-time">
                    <label class="form-field">Ngày thi đấu
                        <input name="match-date" type="date" value="${escapeHtml(matchSchedule.date)}"${useRoundSchedule ? ' disabled' : ''}>
                    </label>
                    <label class="form-field">Giờ bắt đầu
                        <input name="match-time" type="time" value="${escapeHtml(matchSchedule.time)}"${useRoundSchedule ? ' disabled' : ''}>
                    </label>
                    <label class="match-option inherit-round-option"><span>Dùng ngày giờ mặc định của vòng</span><input name="use-round-schedule" type="checkbox"${useRoundSchedule ? ' checked' : ''}></label>
                </div>
                <label class="match-option friendly-option"><span>Trận giao hữu <small>Không tính vào bảng xếp hạng</small></span><input name="friendly" type="checkbox"${friendly ? ' checked' : ''}></label>
                <label class="form-field match-comment">Ghi chú
                    <textarea name="comment" rows="3" maxlength="500" placeholder="Ghi chú cho trận đấu">${escapeHtml(match ? match.comment || '' : '')}</textarea>
                </label>
                <p class="match-scoring-note"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(getSportPreset(state.sport).description)} Điểm xếp hạng được tính tự động.</p>
            </div>
            ${match ? '<button class="button button-danger" data-action="delete-match" type="button"><i class="fa-regular fa-trash-can"></i> Xóa trận đấu</button>' : ''}`;
        }
        return `<div class="form-grid settings-team-count">
                <label class="form-field">Số lượng đội
                    <input value="${state.teams.length}" readonly>
                </label>
                <div class="form-field settings-team-link">
                    <span>Danh sách đội</span>
                    <button class="button button-outline" type="button" data-action="edit-teams-from-settings"><i class="fa-solid fa-people-group"></i> Chỉnh sửa đội</button>
                </div>
            </div>
            ${state.competitionType === 'bracket'
                ? '<p class="bracket-settings-note">Số vòng và nhánh đấu được xác định tự động theo thể thức đấu cúp.</p>'
                : `<div class="form-grid">
                    <label class="form-field">Số bảng đấu
                        <input name="group-count" type="number" min="1" max="${Math.floor(state.teams.length / 2)}" step="1" value="${state.groupCount}" required>
                        <small>Đội được chia đều; mỗi bảng có ít nhất 2 đội.</small>
                    </label>
                <label class="form-field">Số trận mỗi đội
                        <input name="games" type="number" min="${state.homeAwayEnabled && getGroupSizes(state.teams.length, state.groupCount).some(size => size % 2 === 1) ? 4 : state.homeAwayEnabled ? 2 : 1}" max="${maxGamesPerTeam(state.teams.length, state.rounds, state.homeAwayEnabled, state.groupCount)}" step="${state.homeAwayEnabled && getGroupSizes(state.teams.length, state.groupCount).some(size => size % 2 === 1) ? 4 : state.homeAwayEnabled ? 2 : 1}" value="${state.gamesPerTeam}" required>
                </label>
                <label class="form-field">Số tuần / vòng
                        <input name="rounds" type="number" min="${minimumRoundsForGames(state.teams.length, state.gamesPerTeam, state.homeAwayEnabled, state.groupCount)}" max="50" value="${state.rounds}" required>
                </label>
            </div>`}
            <div class="settings-divider"></div>
            <label class="form-field">Tên tổ chức
                <input name="organization" value="${escapeHtml(state.organization)}" placeholder="Tên câu lạc bộ / tổ chức">
            </label>
            <div class="form-grid">
                <label class="form-field">Tên giải đấu
                    <input name="league" value="${escapeHtml(state.league)}" required>
                </label>
                <label class="form-field">Tên mùa giải
                    <input name="season" value="${escapeHtml(state.season)}" required>
                </label>
            </div>
            <label class="form-field">Ngày bắt đầu
                <input name="start-date" type="date" value="${escapeHtml(state.startDate)}">
            </label>
            <label class="form-field">Ngày kết thúc
                <input name="end-date" type="date" value="${escapeHtml(state.endDate)}">
                <small>Lịch giải đấu được xem là đang hoạt động đến hết ngày kết thúc.</small>
            </label>
            <div class="settings-divider"></div>
            <label class="form-field">Môn thể thao
                <select name="sport">
                    <option value="">Chưa chọn</option>
                    ${[['football', 'Bóng đá'], ['futsal', 'Futsal'], ['basketball', 'Bóng rổ'], ['volleyball', 'Bóng chuyền'], ['badminton', 'Cầu lông'], ['tennis', 'Quần vợt'], ['esports', 'Esports'], ['other', 'Khác']].map(([value, label]) => `<option value="${value}"${state.sport === value ? ' selected' : ''}>${label}</option>`).join('')}
                </select>
            </label>
            <div id="sport-scoring-settings">${scoringSettingsFields(state.sport, state.scoring)}</div>
            <label class="form-field">Liên hệ
                <input name="contact" value="${escapeHtml(state.contact)}" placeholder="Tên hoặc email người phụ trách">
            </label>
            <div class="settings-divider"></div>
            <label class="draft-option"><input name="draft" type="checkbox"${state.draft ? ' checked' : ''}> <span><strong>Bản nháp</strong><small>Lịch nháp chưa được công bố.</small></span></label>
            <div class="settings-divider"></div>
            <button class="button button-danger delete-schedule-button" type="button" data-action="delete-schedule"><i class="fa-solid fa-trash-can"></i> Xóa giải đấu</button>`;
    }

    function closeModal() {
        modalBackdrop.classList.add('hidden');
        modalBackdrop.querySelector('.modal').classList.remove('checker-wide', 'match-editor');
        activeModal = '';
        settingsDraft = null;
        editingRound = -1;
        modalForm.classList.remove('checker-modal');
        modalForm.querySelector('.modal-footer .button-primary').classList.remove('hidden');
        document.getElementById('modal-cancel').textContent = 'Hủy';
    }

    async function saveModal(event) {
        event.preventDefault();
        const formData = new FormData(modalForm);
        if (activeModal === 'auth') {
            const email = String(formData.get('account-email') || '').trim();
            const password = String(formData.get('account-password') || '');
            try {
                const services = await getFirebaseServices();
                if (authMode === 'signup') {
                    await services.createUserWithEmailAndPassword(services.auth, email, password);
                    showToast('Đã tạo tài khoản và đăng nhập.');
                } else {
                    await services.signInWithEmailAndPassword(services.auth, email, password);
                    showToast('Đăng nhập thành công.');
                }
                closeModal();
                return;
            } catch (error) {
                showToast(firebaseErrorMessage(error));
                return;
            }
        } else if (activeModal === 'account-profile') {
            const displayName = String(formData.get('account-display-name') || '').trim();
            if (!currentUser) {
                closeModal();
                authMode = 'signin';
                openModal('auth');
                return;
            }
            try {
                const services = await getFirebaseServices();
                const user = services.auth.currentUser;
                if (!user) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
                await services.updateProfile(user, {
                    displayName: displayName || null
                });
                currentUser = user;
                updateAccountNavigation();
                closeModal();
                showToast('Đã cập nhật thông tin tài khoản.');
                return;
            } catch (error) {
                showToast(firebaseErrorMessage(error));
                return;
            }
        } else if (activeModal === 'save-league') {
            const title = String(formData.get('saved-league-title') || '').trim();
            if (!title) {
                showToast('Vui lòng nhập tên giải đấu.');
                return;
            }
            if (!currentUser) {
                authMode = 'signin';
                openModal('auth');
                showToast('Đăng nhập trước khi lưu giải đấu.');
                return;
            }
            try {
                await saveCurrentLeague(title);
                closeModal();
                showToast('Đã lưu giải đấu vào tài khoản.');
                return;
            } catch (error) {
                showToast(firebaseErrorMessage(error));
                return;
            }
        } else if (activeModal === 'settings') {
            const groupCount = state.competitionType === 'bracket'
                ? 1
                : Number(formData.get('group-count'));
            const games = state.competitionType === 'bracket'
                ? state.gamesPerTeam
                : Number(formData.get('games'));
            const rounds = state.competitionType === 'bracket'
                ? state.rounds
                : Number(formData.get('rounds'));
            if (state.competitionType !== 'bracket' &&
                (!Number.isInteger(groupCount) || groupCount < 1 ||
                    groupCount > Math.floor(state.teams.length / 2))) {
                showToast(`Số bảng phải từ 1 đến ${Math.floor(state.teams.length / 2)}.`);
                return;
            }
            if (state.competitionType !== 'bracket' &&
                !validScheduleSettings(games, rounds, groupCount)) return;
            const startDate = String(formData.get('start-date'));
            const endDate = String(formData.get('end-date'));
            if (startDate && endDate && endDate < startDate) {
                showToast('Ngày kết thúc không thể trước ngày bắt đầu.');
                return;
            }
            const sport = String(formData.get('sport'));
            const scoring = {
                win: Number(formData.get('sport-win-points')),
                draw: Number(formData.get('sport-draw-points')),
                loss: Number(formData.get('sport-loss-points')),
                ranking: [1, 2, 3, 4].map(position => String(formData.get(`rank-${position}`)))
            };
            if ([scoring.win, scoring.draw, scoring.loss].some(points =>
                !Number.isInteger(points) || points < 0 || points > 100)) {
                showToast('Điểm thắng, hòa và thua phải là số nguyên từ 0 đến 100.');
                return;
            }
            if (new Set(scoring.ranking).size !== scoring.ranking.length) {
                showToast('Các tiêu chí xếp hạng không được trùng nhau.');
                return;
            }
            const scheduleChanged = games !== state.gamesPerTeam ||
                rounds !== state.rounds || groupCount !== state.groupCount;
            state.organization = String(formData.get('organization')).trim();
            state.league = String(formData.get('league')).trim() || 'Giải đấu mới';
            state.season = String(formData.get('season')).trim() || 'Mùa giải mới';
            state.startDate = startDate;
            state.endDate = endDate;
            state.sport = sport;
            state.scoring = scoring;
            state.contact = String(formData.get('contact')).trim();
            state.draft = formData.has('draft');
            state.gamesPerTeam = games;
            state.rounds = rounds;
            state.groupCount = groupCount;
            if (state.competitionType !== 'bracket') {
                state.advanceBranches = normalizeAdvanceBranches(state.teams.length, groupCount);
            }
            if (scheduleChanged) createSchedule();
            else renderSchedule();
        } else if (activeModal === 'rounds') {
            const rounds = Number(formData.get('rounds'));
            const minimumRounds = minimumRoundsForGames(
                state.teams.length, state.gamesPerTeam, state.homeAwayEnabled, state.groupCount
            );
            if (!Number.isInteger(rounds) || rounds < minimumRounds || rounds > 50) {
                showToast(`Số vòng cần từ ${minimumRounds} đến 50.`);
                return;
            }
            state.rounds = rounds;
            createSchedule();
        } else if (activeModal === 'round-schedule') {
            const date = String(formData.get('round-date') || '');
            const time = String(formData.get('round-time') || '');
            if (!validDateTime(date, time)) {
                showToast('Ngày và giờ cần là ngày hợp lệ, đồng thời phải nhập cùng nhau.');
                return;
            }
            if (date || time) state.roundSchedules[editingRound] = { date, time };
            else delete state.roundSchedules[editingRound];
            renderSchedule();
            notifyScheduleConflicts();
        } else if (activeModal === 'advance-fixture-schedule') {
            const date = String(formData.get('advance-date') || '');
            const time = String(formData.get('advance-time') || '');
            if (!validDateTime(date, time)) {
                showToast('Ngày và giờ cần là ngày hợp lệ, đồng thời phải nhập cùng nhau.');
                return;
            }
            const scheduleCode = editingAdvanceFixtureLegIndex >= 0
                ? advanceFixtureLegCode(editingAdvanceFixtureCode, editingAdvanceFixtureLegIndex)
                : editingAdvanceFixtureCode;
            if (date && time) {
                state.advanceFixtureSchedules[scheduleCode] = { date, time };
                if (editingAdvanceFixtureLegIndex === 0) {
                    delete state.advanceFixtureSchedules[editingAdvanceFixtureCode];
                }
            } else {
                delete state.advanceFixtureSchedules[scheduleCode];
                if (editingAdvanceFixtureLegIndex === 0) {
                    delete state.advanceFixtureSchedules[editingAdvanceFixtureCode];
                }
            }
            renderSchedule();
            closeModal();
        } else if (activeModal === 'teams') {
            const names = formData.getAll('team-name').map(value => String(value).trim());
            const colors = formData.getAll('team-color').map(value => safeTeamColor(value));
            const addedTeams = String(formData.get('bulk-teams') || '')
                .split(/[\n,]+/).map(team => team.trim()).filter(Boolean);
            const teams = names.filter(Boolean).concat(addedTeams);
            const normalized = teams.map(team => team.toLocaleLowerCase());
            if (teams.length < 2 || teams.length > 50) {
                showToast('Danh sách cần có từ 2 đến 50 đội.');
                return;
            }
            if (new Set(normalized).size !== normalized.length) {
                showToast('Tên đội không được trùng nhau.');
                return;
            }
            const nextGroupCount = Math.min(state.groupCount, Math.floor(teams.length / 2));
            const hasOddGroup = getGroupSizes(teams.length, nextGroupCount).some(size => size % 2 === 1);
            const maxGames = maxGamesPerTeam(teams.length, state.rounds, state.homeAwayEnabled, nextGroupCount);
            const minimumGames = state.homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
            const gamesStep = state.homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
            if (state.competitionType !== 'bracket' &&
                (state.gamesPerTeam > maxGames ||
                    state.homeAwayEnabled && (state.gamesPerTeam < minimumGames || state.gamesPerTeam % gamesStep !== 0))) {
                showToast(`Với ${nextGroupCount} bảng, số trận mỗi đội tối đa là ${maxGames}${state.homeAwayEnabled ? (hasOddGroup ? ' (bội số của 4)' : ' (số chẵn)') : ''}.`);
                return;
            }
            const nextColors = {};
            names.forEach((name, index) => {
                if (name) nextColors[name] = colors[index];
            });
            addedTeams.forEach(team => {
                nextColors[team] = state.teamColors[team] || '#42a34f';
            });
            state.teams = teams;
            state.groupCount = nextGroupCount;
            let lastQualifiedRank = 0;
            const maxGroupRank = Math.floor(teams.length / nextGroupCount);
            state.advanceBranches = state.advanceBranches.map(branch => {
                const start = Math.max(branch.start, lastQualifiedRank + 1);
                const end = Math.min(branch.end, maxGroupRank);
                lastQualifiedRank = end;
                return {
                    ...branch,
                    start,
                    end,
                    thirdPlace: branch.thirdPlace && branch.format === 'bracket' && end - start + 1 >= 4
                };
            }).filter(branch => branch.end >= branch.start &&
                (branch.end - branch.start + 1) * nextGroupCount >= 2);
            if (!state.advanceBranches.length) {
                state.advanceBranches = [{
                    start: 1,
                    end: Math.min(nextGroupCount > 1 ? 2 : 4, maxGroupRank),
                    format: 'bracket',
                    thirdPlace: false
                }];
            }
            state.teamColors = nextColors;
            state.teamColorMode = String(formData.get('team-color-mode') || state.teamColorMode);
            createSchedule();
            const savedDraft = settingsDraft;
            closeModal();
            if (savedDraft) {
                openModal('settings');
                for (const [name, value] of Object.entries(savedDraft)) {
                    const input = modalForm.elements.namedItem(name);
                    const restoredValue = name === 'group-count' &&
                        Number(value) > Math.floor(state.teams.length / 2)
                        ? String(state.groupCount)
                        : value;
                    if (input instanceof RadioNodeList) {
                        const option = [...input].find(item => item.value === restoredValue);
                        if (option) option.checked = true;
                    } else if (input instanceof HTMLInputElement && input.type === 'checkbox') {
                        input.checked = restoredValue === 'on';
                    } else if (input) {
                        input.value = restoredValue;
                    }
                }
                updateSettingsScheduleConstraints();
                settingsDraft = null;
                return;
            }
        } else if (activeModal === 'edit-bracket-match' || activeModal === 'edit-third-place-match') {
            const match = activeModal === 'edit-third-place-match'
                ? state.thirdPlaceGame
                : state.bracketGames[editingMatchIndex];
            if (!match || !match.home || !match.away) {
                showToast('Trận đấu chưa xác định đủ hai đội.');
                return;
            }
            const winnerChoice = String(formData.get('bracket-winner') || '');
            let homeScore;
            let awayScore;
            if (state.homeAwayEnabled) {
                const legs = [0, 1].map(index => ({
                    homeScore: parseMatchScore(formData.get(`leg-${index}-home-score`)),
                    awayScore: parseMatchScore(formData.get(`leg-${index}-away-score`)),
                    date: String(formData.get(`leg-${index}-date`) || ''),
                    time: String(formData.get(`leg-${index}-time`) || '')
                }));
                for (const leg of legs) {
                    if ([leg.homeScore, leg.awayScore].some(score =>
                        score !== null && (!Number.isInteger(score) || score < 0 || score > 999))) {
                        showToast('Tỉ số mỗi lượt phải là số nguyên từ 0 đến 999.');
                        return;
                    }
                    if ((leg.homeScore === null) !== (leg.awayScore === null)) {
                        showToast('Hãy nhập tỉ số cho cả hai đội ở mỗi lượt hoặc để trống cả lượt.');
                        return;
                    }
                    if (!validDateTime(leg.date, leg.time)) {
                        showToast('Ngày và giờ mỗi lượt cần hợp lệ, đồng thời phải nhập cùng nhau.');
                        return;
                    }
                }
                const complete = legs.every(leg =>
                    Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore));
                homeScore = complete ? legs.reduce((total, leg) => total + leg.homeScore, 0) : null;
                awayScore = complete ? legs.reduce((total, leg) => total + leg.awayScore, 0) : null;
                if (complete && homeScore === awayScore &&
                    winnerChoice !== match.home && winnerChoice !== match.away) {
                    showToast('Chọn đội thắng khi tổng tỉ số hai lượt hòa.');
                    return;
                }
                match.legs = legs;
                match.date = '';
                match.time = '';
            } else {
                homeScore = parseMatchScore(formData.get('home-score'));
                awayScore = parseMatchScore(formData.get('away-score'));
                const date = String(formData.get('match-date') || '');
                const time = String(formData.get('match-time') || '');
                if ([homeScore, awayScore].some(score =>
                    score !== null && (!Number.isInteger(score) || score < 0 || score > 999))) {
                    showToast('Tỉ số phải là số nguyên từ 0 đến 999.');
                    return;
                }
                if ((homeScore === null) !== (awayScore === null)) {
                    showToast('Hãy nhập tỉ số cho cả hai đội hoặc để trống cả hai.');
                    return;
                }
                if (homeScore !== null && homeScore === awayScore &&
                    winnerChoice !== match.home && winnerChoice !== match.away) {
                    showToast('Chọn đội thắng khi tỉ số hòa để xác định đội đi tiếp.');
                    return;
                }
                if (!validDateTime(date, time)) {
                    showToast('Ngày và giờ cần là ngày hợp lệ, đồng thời phải nhập cùng nhau.');
                    return;
                }
                match.date = date;
                match.time = time;
            }
            match.homeScore = homeScore;
            match.awayScore = awayScore;
            delete match.randomResult;
            match.winnerChoice = homeScore !== null && homeScore === awayScore ? winnerChoice : null;
            match.comment = String(formData.get('comment') || '').trim();
            resolveBracketProgression();
            renderSchedule();
            closeModal();
        } else if (activeModal === 'add-game' || activeModal === 'edit-match') {
            const home = String(formData.get('home'));
            const away = String(formData.get('away'));
            const round = Number(formData.get('round'));
            const useRoundSchedule = formData.has('use-round-schedule');
            const date = useRoundSchedule ? '' : String(formData.get('match-date') || '');
            const time = useRoundSchedule ? '' : String(formData.get('match-time') || '');
            const homeScore = parseMatchScore(formData.get('home-score'));
            const awayScore = parseMatchScore(formData.get('away-score'));
            const homeForfeit = formData.has('home-forfeit');
            const awayForfeit = formData.has('away-forfeit');
            if (home === away) {
                showToast('Một đội không thể thi đấu với chính mình.');
                return;
            }
            if (!validDateTime(date, time)) {
                showToast('Ngày và giờ cần là ngày hợp lệ, đồng thời phải nhập cùng nhau.');
                return;
            }
            if ([homeScore, awayScore].some(score => score !== null && (!Number.isInteger(score) || score < 0 || score > 999))) {
                showToast('Tỉ số phải là số nguyên từ 0 đến 999.');
                return;
            }
            if (homeForfeit && awayForfeit) {
                showToast('Chỉ một đội có thể bỏ cuộc trong một trận.');
                return;
            }
            if ((homeScore === null) !== (awayScore === null) && !homeForfeit && !awayForfeit) {
                showToast('Hãy nhập tỉ số cho cả hai đội.');
                return;
            }
            if (homeScore !== null && awayScore !== null && homeScore === awayScore &&
                ['basketball', 'volleyball', 'badminton', 'tennis'].includes(state.sport) &&
                !homeForfeit && !awayForfeit) {
                showToast('Môn thể thao đã chọn không có kết quả hòa. Hãy kiểm tra tỉ số.');
                return;
            }
            const match = {
                home,
                away,
                round,
                homeScore,
                awayScore,
                homeForfeit,
                awayForfeit,
                friendly: formData.has('friendly'),
                comment: String(formData.get('comment') || '').trim(),
                scheduleOverride: !useRoundSchedule,
                date,
                time,
                custom: true
            };
            if (activeModal === 'add-game') {
                state.matches.push(match);
            } else {
                state.matches[editingMatchIndex] = match;
            }
            populateFilter();
            renderSchedule();
            notifyScheduleConflicts();
        }
        closeModal();
    }

    function validScheduleSettings(games, rounds, groupCount = state.groupCount) {
        const minimumRounds = state.homeAwayEnabled ? 2 : 1;
        if (!Number.isInteger(rounds) || rounds < minimumRounds || rounds > 50) {
            showToast(`Số tuần / vòng phải từ ${minimumRounds} đến 50.`);
            return false;
        }
        const groupSizes = getGroupSizes(state.teams.length, groupCount);
        const hasOddGroup = groupSizes.some(size => size % 2 === 1);
        const requiredRounds = minimumRoundsForGames(
            state.teams.length, games, state.homeAwayEnabled, groupCount
        );
        if (state.homeAwayEnabled && Number.isInteger(games) && games >= 2 && games % 2 === 0 &&
            requiredRounds <= 50 &&
            rounds < requiredRounds) {
            showToast(`Với ${games} trận mỗi đội, cần ít nhất ${requiredRounds} vòng để xếp đủ hai lượt.`);
            return false;
        }
        const maxGames = maxGamesPerTeam(state.teams.length, rounds, state.homeAwayEnabled, groupCount);
        const minimumGames = state.homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
        const gamesStep = state.homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
        if (state.homeAwayEnabled && maxGames < minimumGames) {
            showToast('Số đội trong các bảng không tương thích với thể thức lượt đi, lượt về. Hãy đổi số bảng.');
            return false;
        }
        if (!Number.isInteger(games) || games < minimumGames || games > maxGames ||
            state.homeAwayEnabled && games % gamesStep !== 0) {
            showToast(`Số trận mỗi đội cần là ${state.homeAwayEnabled
                ? (hasOddGroup ? 'bội số của 4' : 'số chẵn từ 2')
                : 'số nguyên từ 1'} đến ${maxGames}.`);
            return false;
        }
        return true;
    }

    function updateSettingsScheduleConstraints() {
        const groupInput = modalContent.querySelector('[name="group-count"]');
        const gamesInput = modalContent.querySelector('[name="games"]');
        const roundsInput = modalContent.querySelector('[name="rounds"]');
        if (!groupInput || !gamesInput || !roundsInput) return;
        const groupCount = Number(groupInput.value);
        if (!Number.isInteger(groupCount) || groupCount < 1 ||
            groupCount > Math.floor(state.teams.length / 2)) return;
        const groupSizes = getGroupSizes(state.teams.length, groupCount);
        const hasOddGroup = groupSizes.some(size => size % 2 === 1);
        const minimumGames = state.homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1;
        const maxGames = maxGamesPerTeam(
            state.teams.length,
            Number(roundsInput.value) || 1,
            state.homeAwayEnabled,
            groupCount
        );
        gamesInput.min = String(minimumGames);
        gamesInput.max = String(Math.max(minimumGames, maxGames));
        gamesInput.step = String(state.homeAwayEnabled ? (hasOddGroup ? 4 : 2) : 1);
        roundsInput.min = String(minimumRoundsForGames(
            state.teams.length,
            Number(gamesInput.value) || minimumGames,
            state.homeAwayEnabled,
            groupCount
        ));
    }

    function parseMatchScore(value) {
        const score = String(value ?? '').trim();
        return score === '' ? null : Number(score);
    }

    function validDateTime(date, time) {
        if (Boolean(date) !== Boolean(time)) return false;
        if (!date) return true;
        const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!parts) return false;
        const parsed = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        return parsed.getFullYear() === Number(parts[1]) &&
            parsed.getMonth() === Number(parts[2]) - 1 &&
            parsed.getDate() === Number(parts[3]) &&
            /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
    }

    function getConsecutiveRoundConflicts() {
        const appearances = new Map();
        state.matches.forEach(match => {
            const schedule = getMatchSchedule(match);
            if (!schedule.time) return;
            [match.home, match.away].forEach(team => {
                if (!appearances.has(team)) appearances.set(team, []);
                appearances.get(team).push({ match, schedule });
            });
        });
        const conflicts = [];
        appearances.forEach((matches, team) => {
            matches.forEach(first => {
                matches.forEach(second => {
                    if (second.match.round === first.match.round + 1 &&
                        first.schedule.time === second.schedule.time) {
                        conflicts.push({ team, first: first.match, second: second.match, firstSchedule: first.schedule, secondSchedule: second.schedule });
                    }
                });
            });
        });
        return conflicts;
    }

    function notifyScheduleConflicts() {
        const conflicts = getConsecutiveRoundConflicts();
        if (conflicts.length) {
            showToast(`Cảnh báo: ${conflicts.length} trường hợp đội thi đấu cùng giờ ở hai vòng liên tiếp. Xem phần Kiểm tra lịch.`);
        }
    }

    function checkSchedule() {
        checkerMode = 'opponents';
        checkerTotals = true;
        openModal('checker');
    }

    function sortedLeagueStandings(matches = state.matches, teams = state.teams) {
        const stats = new Map(teams.map(team => [team, {
            team,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            scored: 0,
            conceded: 0,
            points: 0,
            headToHead: 0
        }]));
        const completedMatches = matches.filter(match => !match.friendly && getMatchPoints(match));
        completedMatches.forEach(match => {
            const home = stats.get(match.home);
            const away = stats.get(match.away);
            if (!home || !away) return;
            const homeScore = Number.isFinite(match.homeScore) ? match.homeScore : 0;
            const awayScore = Number.isFinite(match.awayScore) ? match.awayScore : 0;
            const points = getMatchPoints(match);
            home.played += 1;
            away.played += 1;
            home.scored += homeScore;
            home.conceded += awayScore;
            away.scored += awayScore;
            away.conceded += homeScore;
            home.points += points.home;
            away.points += points.away;
            home.headToHead += points.home;
            away.headToHead += points.away;
            if (points.outcome === 'home') {
                home.wins += 1;
                away.losses += 1;
            } else if (points.outcome === 'away') {
                away.wins += 1;
                home.losses += 1;
            } else if (points.outcome === 'draw') {
                home.draws += 1;
                away.draws += 1;
            }
        });
        const standings = [...stats.values()];
        standings.forEach(team => {
            team.diff = team.scored - team.conceded;
        });
        const sortRules = state.scoring.ranking || ['points', 'diff', 'scored', 'wins'];
        return {
            completedMatches,
            sortedStandings: rankStandings(standings, completedMatches, sortRules)
        };
    }

    function primaryRoundRobinComplete() {
        const leagueMatches = state.matches.filter(match => !match.friendly);
        return leagueMatches.length > 0 && leagueMatches.every(match => Boolean(getMatchPoints(match)));
    }

    function bracketStandingsRows(teams, games) {
        const roundCount = Math.ceil(Math.log2(Math.max(2, teams.length)));
        const rows = new Map(teams.map(team => [team, {
            team,
            place: null,
            played: 0,
            wins: 0,
            losses: 0,
            lastRound: null,
            stoppedAt: null
        }]));

        games.forEach(game => {
            const home = rows.get(game.home);
            const away = rows.get(game.away);
            if (!home || !away) return;
            const played = game.homeAwayEnabled
                ? game.legs.filter(leg =>
                    Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore)
                ).length
                : Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore) ? 1 : 0;
            home.played += played;
            away.played += played;
            if (game.homeAwayEnabled) {
                game.legs.forEach((leg, index) => {
                    if (!Number.isInteger(leg.homeScore) || !Number.isInteger(leg.awayScore)) return;
                    const homeTeam = index === 0 ? home : away;
                    const awayTeam = index === 0 ? away : home;
                    const homeScore = index === 0 ? leg.homeScore : leg.awayScore;
                    const awayScore = index === 0 ? leg.awayScore : leg.homeScore;
                    if (homeScore > awayScore) {
                        homeTeam.wins += 1;
                        awayTeam.losses += 1;
                    } else if (awayScore > homeScore) {
                        awayTeam.wins += 1;
                        homeTeam.losses += 1;
                    }
                });
            }
            if (!game.winner || !Number.isInteger(game.homeScore) || !Number.isInteger(game.awayScore)) return;
            const winner = rows.get(game.winner);
            const loser = rows.get(game.winner === game.home ? game.away : game.home);
            if (!winner || !loser) return;
            if (!game.homeAwayEnabled) {
                winner.wins += 1;
                loser.losses += 1;
            }
            if (game.thirdPlace) {
                winner.place = 3;
                winner.lastRound = roundCount;
                winner.stoppedAt = 'Tranh hạng ba';
                loser.place = 4;
                loser.lastRound = roundCount;
                loser.stoppedAt = 'Tranh hạng ba';
                return;
            }
            const isFinal = game.round === roundCount;
            loser.place = isFinal ? 2 : (2 ** (roundCount - game.round)) + 1;
            loser.lastRound = game.round;
            if (isFinal) {
                winner.place = 1;
                winner.lastRound = game.round;
            }
        });

        const ranked = [...rows.values()].sort((first, second) =>
            (first.place ?? Infinity) - (second.place ?? Infinity) ||
            teams.indexOf(first.team) - teams.indexOf(second.team)
        );
        const placeCounts = new Map();
        ranked.forEach(row => {
            if (row.place !== null) placeCounts.set(row.place, (placeCounts.get(row.place) || 0) + 1);
        });
        return ranked.map(row => {
            let placement = '—';
            if (row.place === 1) placement = 'Vô địch';
            else if (row.place === 2) placement = 'Á quân';
            else if (row.place !== null && placeCounts.get(row.place) > 1) placement = `Đồng hạng ${row.place}`;
            else if (row.place !== null) placement = `Hạng ${row.place}`;
            const stoppedAt = row.stoppedAt || (row.lastRound === null
                ? (row.played ? 'Đang thi đấu' : 'Chưa thi đấu')
                : getBracketRoundName(row.lastRound, roundCount));
            return { ...row, placement, stoppedAt };
        });
    }

    function bracketStandingsTableMarkup(title, subtitle, teams, games) {
        const rows = bracketStandingsRows(teams, games);
        return `<section class="branch-standings">
            <div class="branch-standings-heading">
                <h3>${escapeHtml(title)}</h3>
                <span>${escapeHtml(subtitle)}</span>
            </div>
            <div class="standings-table-scroll"><table class="standings-table bracket-standings-table">
                <thead><tr><th>#</th><th>Đội</th><th>Xếp hạng</th><th>Vòng dừng</th><th>Đ</th><th>T</th><th>B</th></tr></thead>
                <tbody>${rows.map((row, index) => `<tr>
                    <td>${index + 1}</td>
                    <th>${teamPageLink(row.team)}</th>
                    <td>${escapeHtml(row.placement)}</td>
                    <td>${escapeHtml(row.stoppedAt)}</td>
                    <td>${row.played}</td>
                    <td>${row.wins}</td>
                    <td>${row.losses}</td>
                </tr>`).join('')}</tbody>
            </table></div>
        </section>`;
    }

    function standingsContent() {
        const { completedMatches, sortedStandings } = sortedLeagueStandings();
        const groupedStandings = splitTeamsIntoGroups().map((teams, groupIndex) => ({
            teams,
            groupIndex,
            sortedStandings: sortedLeagueStandings(
                state.matches.filter(match => teams.includes(match.home) && teams.includes(match.away)),
                teams
            ).sortedStandings
        }));
        const sortRules = state.scoring.ranking || ['points', 'diff', 'scored', 'wins'];
        const advanceBranches = state.advanceEnabled ? state.advanceBranches : [];
        const advanceFixtures = state.advanceEnabled ? buildAdvanceFixtures() : [];
        const completedAdvanceMatches = advanceFixtures
            .flatMap(advanceFixtureLegRows)
            .filter(fixture =>
                Number.isInteger(fixture.homeScore) &&
                Number.isInteger(fixture.awayScore) &&
                (fixture.format !== 'bracket' ||
                    fixture.homeAwayEnabled ||
                    fixture.homeScore !== fixture.awayScore ||
                    fixture.winner === fixture.home ||
                    fixture.winner === fixture.away)
            );
        const completedMainBracketMatches = state.competitionType === 'bracket'
            ? state.bracketGames.filter(game =>
                Number.isInteger(game.homeScore) &&
                Number.isInteger(game.awayScore) &&
                (game.homeScore !== game.awayScore ||
                    game.winner === game.home ||
                    game.winner === game.away)
            )
            : [];
        const completedThirdPlaceMatch = state.competitionType === 'bracket' &&
            state.thirdPlaceGame && state.thirdPlaceGame.home && state.thirdPlaceGame.away &&
            Number.isInteger(state.thirdPlaceGame.homeScore) &&
            Number.isInteger(state.thirdPlaceGame.awayScore) &&
            (state.thirdPlaceGame.homeScore !== state.thirdPlaceGame.awayScore ||
                state.thirdPlaceGame.winner === state.thirdPlaceGame.home ||
                state.thirdPlaceGame.winner === state.thirdPlaceGame.away);
        const totalCompletedMatches = completedMatches.length +
            completedAdvanceMatches.length +
            completedMainBracketMatches.length +
            Number(Boolean(completedThirdPlaceMatch));
        const roundRobinBranches = advanceBranches
            .map((branch, branchIndex) => ({ ...branch, branchIndex }))
            .filter(branch => branch.format === 'round-robin');

        const scoreLabel = state.sport === 'volleyball' || state.sport === 'badminton' || state.sport === 'tennis'
            ? 'Set'
            : state.sport === 'basketball' ? 'Điểm ghi' : 'Bàn thắng';
        const standingsTable = rows => `<div class="standings-table-scroll"><table class="standings-table">
            <thead><tr><th>#</th><th>Đội</th>${advanceBranches.length ? '<th>Vòng tiếp theo</th>' : ''}<th>Đ</th><th>T</th><th>H</th><th>B</th><th>${scoreLabel}</th><th>HS</th><th>Điểm</th></tr></thead>
            <tbody>${rows.map((team, index) => {
                const rank = index + 1;
                const qualifiedBranch = advanceBranches.findIndex(branch =>
                    rank >= branch.start && rank <= branch.end
                );
                return `<tr>
                    <td>${rank}</td>
                    <th>${teamPageLink(team.team)}</th>
                    ${advanceBranches.length ? `<td>${qualifiedBranch >= 0
                        ? `<span class="qualification-badge">Nhánh ${qualifiedBranch + 1}</span>`
                        : '—'}</td>` : ''}
                    <td>${team.played}</td>
                    <td>${team.wins}</td>
                    <td>${team.draws}</td>
                    <td>${team.losses}</td>
                    <td>${team.scored}:${team.conceded}</td>
                    <td>${team.diff > 0 ? `+${team.diff}` : team.diff}</td>
                    <td><strong>${team.points}</strong></td>
                </tr>`;
            }).join('')}</tbody>
        </table></div>`;
        const table = state.competitionType === 'bracket'
            ? ''
            : state.groupCount > 1
                ? groupedStandings.map(group => `<section class="branch-standings">
                    <div class="branch-standings-heading">
                        <h3>${groupLabel(group.groupIndex)}</h3>
                        <span>${group.teams.length} đội</span>
                    </div>
                    ${standingsTable(group.sortedStandings)}
                </section>`).join('')
                : standingsTable(sortedStandings);
        const overallPositions = new Map();
        if (state.groupCount > 1) {
            groupedStandings.forEach(group => group.sortedStandings.forEach((team, index) => {
                overallPositions.set(team.team, `${groupLabel(group.groupIndex)} · Hạng ${index + 1}`);
            }));
        } else {
            sortedStandings.forEach((team, index) => overallPositions.set(team.team, index + 1));
        }
        const branchTables = advanceBranches.map((branch, branchIndex) => {
            if (branch.format === 'bracket') {
                const branchFixtures = advanceFixtures.filter(fixture => fixture.branchIndex === branchIndex);
                const branchTeams = branchFixtures.reduce((teams, fixture) => {
                    [fixture.home, fixture.away].forEach(team => {
                        if (team && !teams.includes(team)) teams.push(team);
                    });
                    return teams;
                }, []);
                return bracketStandingsTableMarkup(
                    `Nhánh ${branchIndex + 1} · Loại trực tiếp`,
                    `${state.groupCount > 1 ? 'Hạng mỗi bảng ' : 'Hạng '}${branch.start}–${branch.end} · ${(branch.end - branch.start + 1) * state.groupCount} đội`,
                    branchTeams,
                    branchFixtures
                );
            }
            const branchFixtures = advanceFixtures.filter(fixture => fixture.branchIndex === branchIndex);
            const branchTeams = branchFixtures.reduce((teams, fixture) => {
                [fixture.home, fixture.away].forEach(team => {
                    if (team && !teams.includes(team)) teams.push(team);
                });
                return teams;
            }, []);
            const branchMatches = branchFixtures.map(fixture => ({
                home: fixture.home,
                away: fixture.away,
                round: fixture.round,
                homeScore: fixture.homeScore,
                awayScore: fixture.awayScore,
                homeForfeit: false,
                awayForfeit: false,
                friendly: false
            }));
            const branchStandings = sortedLeagueStandings(branchMatches, branchTeams).sortedStandings;
            return `<section class="branch-standings">
                <div class="branch-standings-heading">
                    <h3>Nhánh ${branchIndex + 1} · Vòng tròn</h3>
                    <span>${state.groupCount > 1 ? 'Hạng mỗi bảng ' : 'Hạng '}${branch.start}–${branch.end} · ${branchTeams.length} đội</span>
                </div>
                <div class="standings-table-scroll"><table class="standings-table branch-standings-table">
                    <thead><tr><th>#</th><th>Đội</th><th>${state.groupCount > 1 ? 'Hạng bảng' : 'Hạng chung'}</th><th>Đ</th><th>T</th><th>H</th><th>B</th><th>${scoreLabel}</th><th>HS</th><th>Điểm</th></tr></thead>
                    <tbody>${branchStandings.map((team, index) => `<tr>
                        <td>${index + 1}</td>
                        <th>${teamPageLink(team.team)}</th>
                        <td>${overallPositions.get(team.team) || '—'}</td>
                        <td>${team.played}</td>
                        <td>${team.wins}</td>
                        <td>${team.draws}</td>
                        <td>${team.losses}</td>
                        <td>${team.scored}:${team.conceded}</td>
                        <td>${team.diff > 0 ? `+${team.diff}` : team.diff}</td>
                        <td><strong>${team.points}</strong></td>
                    </tr>`).join('')}</tbody>
                </table></div>
            </section>`;
        }).join('');
        const hasBracketBranch = advanceBranches.some(branch => branch.format === 'bracket');
        const mainBracketTable = state.competitionType === 'bracket'
            ? bracketStandingsTableMarkup(
                'Bảng xếp hạng · Loại trực tiếp',
                `${state.teams.length} đội`,
                state.teams,
                state.thirdPlaceGame && state.thirdPlaceGame.home && state.thirdPlaceGame.away
                    ? state.bracketGames.concat({
                        ...state.thirdPlaceGame,
                        round: Math.ceil(Math.log2(state.teams.length)),
                        position: 0,
                        thirdPlace: true
                    })
                    : state.bracketGames
            )
            : '';

        return `<div class="standings-print-heading"><strong>${escapeHtml(state.league)}</strong><span>Bảng xếp hạng</span></div>
            <div class="standings-actions">
                <button class="button button-outline" type="button" data-action="print-standings"><i class="fa-solid fa-print"></i> In bảng xếp hạng</button>
            </div>
            <div class="standings-summary">
                <span>${escapeHtml(state.sport ? getSportName(state.sport) : 'Chưa chọn môn thể thao')}</span>
                <span>${totalCompletedMatches} trận có kết quả</span>
            </div>
            ${advanceBranches.length ? `<div class="qualification-note">${advanceBranches.map((branch, index) =>
                `<p><strong>Nhánh ${index + 1}:</strong> ${state.groupCount > 1 ? 'hạng mỗi bảng ' : 'hạng '}${branch.start}–${branch.end} · ${branch.format === 'bracket' ? 'Loại trực tiếp' : 'Vòng tròn'}${branch.thirdPlace ? ' · Tranh hạng ba' : ''}</p>`
            ).join('')}</div>` : ''}
            ${table}
            ${branchTables}
            ${mainBracketTable}
            ${hasBracketBranch || state.competitionType === 'bracket'
                ? '<p class="standings-note branch-standings-note">Các đội bị loại cùng một vòng xếp đồng hạng nếu không có trận phân định thứ hạng; các đội chưa bị loại vẫn được liệt kê.</p>'
                : ''}
            ${roundRobinBranches.length
                ? `<p class="standings-note branch-standings-note">Bảng vòng tròn của từng nhánh chỉ tính kết quả các trận đã mô phỏng trong chính nhánh đó. ${state.groupCount > 1 ? '“Hạng bảng” là thứ hạng ban đầu của đội trong bảng vòng tròn.' : '“Hạng chung” là thứ hạng của đội ở vòng tròn ban đầu.'}</p>`
                : ''}
            ${state.competitionType !== 'bracket'
                ? `<p class="standings-note">Trận giao hữu và trận chưa nhập kết quả không được tính. Ưu tiên xếp hạng: ${sortRules.map((rule, index) => `${index + 1}. ${escapeHtml(getSportPreset(state.sport).labels[rule])}`).join(' · ')}.</p>`
                : ''}`;
    }

    function rankStandings(teams, completedMatches, rules, ruleIndex = 0) {
        if (teams.length < 2 || ruleIndex >= rules.length) {
            return [...teams].sort((first, second) => first.team.localeCompare(second.team));
        }

        const rule = rules[ruleIndex];
        const groupTeams = new Set(teams.map(team => team.team));
        const headToHead = new Map(teams.map(team => [team.team, 0]));
        if (rule === 'headToHead') {
            completedMatches.forEach(match => {
                if (!groupTeams.has(match.home) || !groupTeams.has(match.away)) return;
                const points = getMatchPoints(match);
                if (!points) return;
                headToHead.set(match.home, headToHead.get(match.home) + points.home);
                headToHead.set(match.away, headToHead.get(match.away) + points.away);
            });
        }

        const valueFor = team => rule === 'headToHead' ? headToHead.get(team.team) : Number(team[rule] || 0);
        const ascending = rule === 'losses' || rule === 'conceded';
        const ordered = [...teams].sort((first, second) => {
            const difference = ascending
                ? valueFor(first) - valueFor(second)
                : valueFor(second) - valueFor(first);
            return difference || first.team.localeCompare(second.team);
        });

        const tiedGroups = [];
        ordered.forEach(team => {
            const value = valueFor(team);
            const lastGroup = tiedGroups[tiedGroups.length - 1];
            if (!lastGroup || lastGroup.value !== value) {
                tiedGroups.push({ value, teams: [team] });
            } else {
                lastGroup.teams.push(team);
            }
        });
        return tiedGroups.flatMap(group => rankStandings(group.teams, completedMatches, rules, ruleIndex + 1));
    }

    function getSportName(sport) {
        return ({
            football: 'Bóng đá',
            futsal: 'Futsal',
            basketball: 'Bóng rổ',
            volleyball: 'Bóng chuyền',
            badminton: 'Cầu lông',
            tennis: 'Quần vợt',
            esports: 'Esports',
            other: 'Môn thể thao khác'
        })[sport] || 'Chưa chọn môn thể thao';
    }

    function checkerContent() {
        const scheduleConflicts = getConsecutiveRoundConflicts();
        const advanceFixtureCount = state.advanceEnabled ? buildAdvanceFixtures().length : 0;
        const opponents = Array.from(state.teams, () => Array(state.teams.length).fill(0));
        const homeAway = Array.from(state.teams, () =>
            Array.from(state.teams, () => ({ home: 0, away: 0 })));
        const roundCounts = Array.from(state.teams, () => Array(state.rounds).fill(0));
        const appearances = Array(state.teams.length).fill(0);
        const teamIndex = new Map(state.teams.map((team, index) => [team, index]));

        state.matches.forEach(match => {
            const home = teamIndex.get(match.home);
            const away = teamIndex.get(match.away);
            if (home === undefined || away === undefined) return;
            opponents[home][away] += 1;
            opponents[away][home] += 1;
            homeAway[home][away].home += 1;
            homeAway[away][home].away += 1;
            appearances[home] += 1;
            appearances[away] += 1;
            if (match.round >= 1 && match.round <= state.rounds) {
                roundCounts[home][match.round - 1] += 1;
                roundCounts[away][match.round - 1] += 1;
            }
        });

        const checkerTable = checkerMode === 'opponents'
            ? `<div class="checker-table-scroll"><table class="checker-table">
                <thead><tr><th>Đội</th>${state.teams.map((team, index) => `<th title="${escapeHtml(team)}" aria-label="${escapeHtml(team)}">${teamPageLink(team, String(index + 1), 'checker-team-column')}</th>`).join('')}</tr></thead>
                <tbody>${state.teams.map((team, row) => `<tr><th>${teamPageLink(team)}</th>${state.teams.map((_, column) => {
                    if (row === column) return `<td class="checker-diagonal">${checkerTotals ? appearances[row] : '—'}</td>`;
                    return `<td>${checkerTotals ? opponents[row][column] : `${homeAway[row][column].home} / ${homeAway[row][column].away}`}</td>`;
                }).join('')}</tr>`).join('')}</tbody>
            </table></div>`
            : `<div class="checker-table-scroll"><table class="checker-table">
                <thead><tr><th>Đội</th>${Array.from({ length: state.rounds }, (_, index) => `<th>${index + 1}</th>`).join('')}</tr></thead>
                <tbody>${state.teams.map((team, row) => `<tr><th>${teamPageLink(team)}</th>${roundCounts[row].map(count => `<td>${count}</td>`).join('')}</tr>`).join('')}</tbody>
            </table></div>`;

        return `<div class="checker-summary">
                <span><strong>${state.matches.length + advanceFixtureCount}</strong> trận toàn giải</span>
                <span><strong>${state.teams.length}</strong> đội</span>
                <span><strong>${state.rounds}</strong> vòng</span>
            </div>
            <div class="checker-controls">
                <div class="checker-tabs">
                    <button class="button ${checkerMode === 'opponents' ? 'button-primary' : 'button-outline'}" type="button" data-action="checker-mode" data-mode="opponents"><i class="fa-solid fa-people-arrows-left-right"></i> Đối thủ</button>
                    <button class="button ${checkerMode === 'rounds' ? 'button-primary' : 'button-outline'}" type="button" data-action="checker-mode" data-mode="rounds"><i class="fa-solid fa-table-cells"></i> Vòng đấu</button>
                </div>
                ${checkerMode === 'opponents' ? `<label class="checker-total-toggle"><input type="checkbox" data-action="checker-totals"${checkerTotals ? ' checked' : ''}> ${checkerTotals ? 'Tổng số' : 'Sân nhà / khách'}</label>` : ''}
            </div>
            <h3 class="checker-section-title">${checkerMode === 'opponents' ? 'Đối thủ' : 'Số trận theo vòng'}</h3>
            ${checkerTable}
            <p class="checker-note">Ô trên đường chéo hiển thị tổng số trận của từng đội.</p>
            <section class="schedule-conflicts" aria-live="polite">
                <h3>${scheduleConflicts.length ? 'Cảnh báo trùng giờ' : 'Kiểm tra khung giờ'}</h3>
                ${scheduleConflicts.length
                    ? `<ul>${scheduleConflicts.map(conflict => `<li>${teamPageLink(conflict.team)} thi đấu lúc ${escapeHtml(formatMatchDateTime(conflict.firstSchedule.date, conflict.firstSchedule.time))} ở vòng ${conflict.first.round} (${teamPageLink(conflict.first.home)} – ${teamPageLink(conflict.first.away)}) và lúc ${escapeHtml(formatMatchDateTime(conflict.secondSchedule.date, conflict.secondSchedule.time))} ở vòng ${conflict.second.round} (${teamPageLink(conflict.second.home)} – ${teamPageLink(conflict.second.away)}).</li>`).join('')}</ul>`
                    : '<p>Không có đội nào bị xếp cùng giờ ở hai vòng liên tiếp.</p>'}
            </section>`;
    }

    async function handleModalAction(event) {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'toggle-auth-mode') {
            authMode = authMode === 'signin' ? 'signup' : 'signin';
            openModal('auth');
        } else if (action === 'account-sign-out') {
            closeModal();
            await signOutUser();
        } else if (action === 'open-saved-league') {
            try {
                await openSavedLeague(button.dataset.leagueId);
                closeModal();
            } catch (error) {
                showToast(firebaseErrorMessage(error));
            }
        } else if (action === 'delete-saved-league') {
            const leagueId = button.dataset.leagueId;
            if (!window.confirm('Xóa giải đấu đã lưu này? Thao tác này không thể hoàn tác.')) return;
            try {
                await deleteSavedLeague(leagueId);
                await openMySchedules();
                showToast('Đã xóa giải đấu.');
            } catch (error) {
                showToast(firebaseErrorMessage(error));
            }
        } else if (action === 'copy-share-link') {
            await copyShareLink(button.dataset.shareId);
        } else if (action === 'copy-active-share') {
            await copyShareLink(currentShareId);
        } else if (action === 'unpublish-league') {
            try {
                await unpublishLeague(button.dataset.leagueId, button.dataset.shareId);
                await openMySchedules();
                showToast('Đã tắt liên kết chia sẻ.');
            } catch (error) {
                showToast(firebaseErrorMessage(error));
            }
        } else if (action === 'add-team') {
            const rows = modalContent.querySelectorAll('.team-edit-row').length;
            if (rows >= 50) {
                showToast('Danh sách không thể vượt quá 50 đội.');
                return;
            }
            const row = document.createElement('div');
            row.className = 'team-edit-row';
            row.innerHTML = `<span class="team-edit-number">${rows + 1}</span>
                <input class="team-name-input" name="team-name" value="" maxlength="60" aria-label="Tên đội ${rows + 1}" placeholder="Tên đội">
                <input class="team-color-input${modalContent.querySelector('[name="team-color-mode"]:checked')?.value === 'visible' ? '' : ' hidden'}" name="team-color" type="color" value="#42a34f" aria-label="Màu đội ${rows + 1}">
                <button class="team-remove-button" type="button" data-action="remove-team" aria-label="Xóa đội"><i class="fa-solid fa-trash-can"></i></button>`;
            modalContent.querySelector('.team-edit-list').append(row);
            row.querySelector('.team-name-input').focus();
            updateTeamRowNumbers();
        } else if (action === 'remove-team') {
            button.closest('.team-edit-row').remove();
            updateTeamRowNumbers();
        } else if (action === 'toggle-bulk') {
            const field = modalContent.querySelector('.bulk-team-field');
            field.classList.toggle('hidden');
            button.querySelector('i').classList.toggle('fa-rotate-90');
            if (!field.classList.contains('hidden')) field.querySelector('textarea').focus();
        } else if (action === 'edit-teams-from-settings') {
            settingsDraft = Object.fromEntries(new FormData(modalForm));
            settingsDraft.draft = modalForm.elements.namedItem('draft').checked ? 'on' : '';
            openModal('teams');
        } else if (action === 'checker-mode') {
            checkerMode = button.dataset.mode;
            modalContent.innerHTML = checkerContent();
        } else if (action === 'clear-round-schedule') {
            delete state.roundSchedules[editingRound];
            renderSchedule();
            closeModal();
            notifyScheduleConflicts();
        } else if (action === 'delete-match') {
            state.matches.splice(editingMatchIndex, 1);
            renderSchedule();
            closeModal();
            showToast('Đã xóa trận đấu.');
        } else if (action === 'delete-schedule') {
            if (!window.confirm('Bạn có chắc muốn xóa giải đấu và lịch thi đấu này?')) return;
            state.teams = ['Đội 1', 'Đội 2'];
            state.teamColors = { 'Đội 1': '#42a34f', 'Đội 2': '#42a34f' };
            state.gamesPerTeam = 1;
            state.rounds = 1;
            state.league = 'Giải đấu mới';
            state.season = 'Mùa giải mới';
            state.organization = '';
            state.startDate = '';
            state.endDate = '';
            state.sport = '';
            state.scoring = getSportPreset('');
            state.roundSchedules = {};
            state.competitionType = 'round-robin';
            state.groupCount = 1;
            state.homeAwayEnabled = false;
            state.bracketFormat = 'single';
            state.bracketConsolation = 'none';
            state.bracketThirdPlaceEnabled = false;
            state.advanceEnabled = false;
            state.advanceBranches = [{ start: 1, end: 2, format: 'bracket', thirdPlace: false }];
            state.advanceFixtureSchedules = {};
            state.advanceFixtureResults = {};
            state.advanceFixtureRoundModes = {};
            state.bracketGames = [];
            state.thirdPlaceGame = null;
            state.contact = '';
            state.draft = false;
            state.matches = [];
            closeModal();
            showSetup();
            teamCountInput.value = 2;
            groupCountInput.value = 1;
            gamesInput.value = 1;
            weeksInput.value = 1;
            showToast('Đã xóa giải đấu.');
        }
    }

    function updateTeamRowNumbers() {
        modalContent.querySelectorAll('.team-edit-row').forEach((row, index) => {
            row.querySelector('.team-edit-number').textContent = index + 1;
            row.querySelector('.team-name-input').setAttribute('aria-label', `Tên đội ${index + 1}`);
            row.querySelector('.team-color-input').setAttribute('aria-label', `Màu đội ${index + 1}`);
        });
    }

    async function copySchedule() {
        try {
            await navigator.clipboard.writeText(scheduleText());
            showToast('Đã sao chép lịch thi đấu.');
        } catch (error) {
            showToast('Không thể sao chép. Hãy kiểm tra quyền truy cập clipboard của trình duyệt.');
        }
    }

    function scheduleText() {
        const lines = [`${state.league} — ${state.season}`];
        if (state.competitionType === 'bracket') {
            lines.push(
                `Thể thức: ${state.bracketFormat === 'double' ? 'Loại kép' : 'Loại đơn'}`,
                `Thi đấu: ${state.homeAwayEnabled ? 'Lượt đi, lượt về' : 'Một trận mỗi vòng'}`,
                `Nhánh phụ: ${state.bracketFormat === 'double' ? 'Nhánh thua' : ({
                    none: 'Không có',
                    full: 'Consolation đầy đủ'
                })[state.bracketConsolation]}`
            );
            lines.push(`Tranh hạng ba: ${state.bracketThirdPlaceEnabled ? 'Có' : 'Không'}`);
            state.bracketGames.forEach(game => {
                const home = game.home || `Chờ vòng ${game.round - 1}`;
                const away = game.away || (game.round === 1 ? 'BYE' : `Chờ vòng ${game.round - 1}`);
                const score = Number.isInteger(game.homeScore) && Number.isInteger(game.awayScore)
                    ? ` (${game.homeScore}–${game.awayScore})`
                    : '';
                const dateTime = game.date || game.time ? ` [${formatMatchDateTime(game.date, game.time)}]` : '';
                const legs = state.homeAwayEnabled ? ` [${game.legs.map((leg, index) => {
                    const legScore = Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore)
                        ? `${leg.homeScore}–${leg.awayScore}`
                        : 'chưa có tỉ số';
                    const legDate = leg.date || leg.time
                        ? `, ${formatMatchDateTime(leg.date, leg.time)}`
                        : '';
                    return `${index === 0 ? 'Lượt đi' : 'Lượt về'}: ${legScore}${legDate}`;
                }).join('; ')}]` : '';
                const bye = game.round === 1 && (game.home || game.away) && !(game.home && game.away)
                    ? ' — Miễn đấu'
                    : '';
                const winner = game.winner ? ` — Đi tiếp: ${game.winner}` : '';
                lines.push(`Vòng ${game.round}, trận ${game.position + 1}: ${home} vs ${away}${score}${legs}${dateTime}${bye}${winner}`);
            });
            const thirdPlaceGame = state.thirdPlaceGame;
            if (thirdPlaceGame && thirdPlaceGame.home && thirdPlaceGame.away) {
                const score = Number.isInteger(thirdPlaceGame.homeScore) &&
                    Number.isInteger(thirdPlaceGame.awayScore)
                    ? ` (${thirdPlaceGame.homeScore}–${thirdPlaceGame.awayScore})`
                    : '';
                const dateTime = thirdPlaceGame.date || thirdPlaceGame.time
                    ? ` [${formatMatchDateTime(thirdPlaceGame.date, thirdPlaceGame.time)}]`
                    : '';
                const legs = state.homeAwayEnabled ? ` [${thirdPlaceGame.legs.map((leg, index) => {
                    const legScore = Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore)
                        ? `${leg.homeScore}–${leg.awayScore}`
                        : 'chưa có tỉ số';
                    const legDate = leg.date || leg.time
                        ? `, ${formatMatchDateTime(leg.date, leg.time)}`
                        : '';
                    return `${index === 0 ? 'Lượt đi' : 'Lượt về'}: ${legScore}${legDate}`;
                }).join('; ')}]` : '';
                const winner = thirdPlaceGame.winner
                    ? ` — Hạng ba: ${thirdPlaceGame.winner}`
                    : '';
                lines.push(`Tranh hạng ba: ${thirdPlaceGame.home} vs ${thirdPlaceGame.away}${score}${legs}${dateTime}${winner}`);
            }
            return lines.join('\n');
        }
        if (state.advanceEnabled) {
            state.advanceBranches.forEach((branch, index) => {
                lines.push(`Nhánh ${index + 1}: ${state.groupCount > 1 ? 'hạng mỗi bảng ' : 'hạng '}${branch.start}–${branch.end} — ${branch.format === 'bracket' ? 'Loại trực tiếp' : 'Vòng tròn'}${branch.thirdPlace ? ' · Tranh hạng ba' : ''}.`);
            });
        }
        if (state.groupCount > 1) lines.push(`Vòng tròn: ${state.groupCount} bảng, chia đội cân bằng.`);
        if (state.homeAwayEnabled) lines.push('Thi đấu: lượt đi, lượt về; các cặp đổi sân ở lượt về.');
        const advanceFixtures = state.advanceEnabled ? buildAdvanceFixtures() : [];
        for (let round = 1; round <= state.rounds; round += 1) {
            const roundSchedule = getRoundSchedule(round);
            const roundDateTime = formatMatchDateTime(roundSchedule.date, roundSchedule.time);
            lines.push('', `Vòng ${round}${roundDateTime ? ` — ${roundDateTime}` : ''}`);
            const games = state.matches.filter(match => match.round === round);
            if (!games.length) lines.push('Chưa có trận đấu.');
            games.forEach(match => {
                const points = getMatchPoints(match);
                const schedule = getMatchSchedule(match);
                const score = points
                    ? ` (${match.homeForfeit ? 'Bỏ cuộc' : (match.homeScore ?? 0)}–${match.awayForfeit ? 'Bỏ cuộc' : (match.awayScore ?? 0)})`
                    : '';
                const friendly = match.friendly ? ' [Giao hữu]' : '';
                const comment = match.comment ? ` — ${match.comment}` : '';
                const dateTime = schedule.date || schedule.time ? ` [${formatMatchDateTime(schedule.date, schedule.time)}]` : '';
                lines.push(`${state.groupCount > 1 ? `${groupLabel(match.group - 1)}: ` : ''}${match.home} vs ${match.away}${score}${dateTime}${friendly}${comment}`);
            });
            const playingTeams = new Set(games.flatMap(match => [match.home, match.away]));
            const byes = state.teams.filter(team => !playingTeams.has(team));
            if (byes.length) lines.push(`Đội nghỉ: ${byes.join(' · ')}`);
        }
        if (state.advanceEnabled) {
            lines.push('', `Vòng tiếp theo (${advanceFixtureMatchCount(advanceFixtures)} trận)`);
            advanceFixtures.forEach(game => {
                advanceFixtureLegRows(game).forEach(leg => {
                    const schedule = leg.date && leg.time
                        ? ` [${formatMatchDateTime(leg.date, leg.time)}]`
                        : '';
                    const score = Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore)
                        ? ` (${leg.homeScore}–${leg.awayScore})`
                        : '';
                    const winner = game.winner ? ` — Đi tiếp: ${game.winner}` : '';
                    lines.push(`Nhánh ${game.branchIndex + 1}, ${game.thirdPlace ? 'tranh hạng ba' : `vòng ${game.round}`}, ${leg.displayCode}: ${leg.home} vs ${leg.away}${score}${schedule}${winner}`);
                });
            });
            lines.push('', `Tổng số trận toàn giải: ${state.matches.length + advanceFixtureMatchCount(advanceFixtures)}`);
        }
        return lines.join('\n');
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('visible');
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3200);
    }

    function safeTeamColor(value) {
        return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#42a34f';
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

});
