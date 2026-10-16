import { useState, useEffect } from 'react';
import { tr } from './adminUi';

// Админка → Заявки: последние 500 заявок как в базе (get_admin_data.php), плитками.
const ST_CLASS = { pending: 'pending', in_progress: 'in_progress', done: 'done' };

export default function AdminTasks({ lang }) {
    const t = tr(lang);
    const [tasks, setTasks] = useState(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`/backend/api/get_admin_data.php?lang=${lang}`)
            .then(r => r.json())
            .then(d => { if (!cancelled) setTasks(d.success ? d.tasks || [] : []); })
            .catch(() => { if (!cancelled) setTasks([]); });
        return () => { cancelled = true; };
    }, [lang]);

    if (tasks === null) return <div className="ad-empty">{t.loading}</div>;

    return (
        <>
            <div className="ad-pad ad-hint">{t.tasks_last}</div>
            <div className="ad-list">
                {tasks.length === 0 && <div className="ad-empty">{t.empty}</div>}
                <div className="ad-grid">
                    {tasks.map(tk => (
                        <div key={tk.id} className="wk-tile open ad-static">
                            <div className="wk-meta">
                                <span><bdi>ID {tk.id}</bdi></span>
                                <span>{t.type}: <b className="ad-mono" style={{ color: 'var(--accent)' }}>{tk.task_type}</b></span>
                                <span>{t.created}: <bdi>{tk.created_at}</bdi></span>
                            </div>
                            <div className="wk-row">
                                <div className="txt"><div className="wk-task" style={{ fontSize: '17px' }}>{tk.description}</div></div>
                                <span className={'ad-st ad-mono ' + (ST_CLASS[tk.status] || 'grey')} style={{ fontSize: '12px', alignSelf: 'flex-start' }}>{tk.status}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
