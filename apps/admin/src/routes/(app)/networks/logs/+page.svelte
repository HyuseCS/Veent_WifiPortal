<script lang="ts">
	import { RouterLogPanel } from '$lib/components/feature';
</script>

<!-- Mobile router-log page: the Networks page hides the inline log below md; the Topbar header
     ("Networks" button) handles getting back. Full-height column → the terminal scrolls inside
     the panel, not the page. -->
<div class="h-full">
	<RouterLogPanel />
</div>
